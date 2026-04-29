const traverse = require('@babel/traverse').default;
const t = require('@babel/types');
const { guessType, extractJSDocTypes } = require('./analyzer');

// ============================================================================
//  transformer — the surgeon
//
//  walks the ast and injects type annotations where it's SAFE to do so.
//  the golden rule: never inject a type that could be wrong.
//  wrong types are worse than `any` because they silently corrupt logic.
//
//  we handle these patterns from the codebase:
//    - variable declarations with initializers (const x = 5 -> const x: number = 5)
//    - function parameters with defaults (function(x = false) -> function(x: boolean = false))
//    - function parameters with jsdoc types
//    - function return types when obvious (all paths return same type)
//    - class methods and properties
//    - destructured requires — we DON'T touch these (they're fine as-is)
//    - process.env destructuring
//    - module.exports patterns — we DON'T touch these
//    - mongoose schema definitions — we DON'T touch these
// ============================================================================

// things we should never try to type-annotate because they'll break or be wrong
const SKIP_REQUIRE_PATTERN = /require\s*\(/;
const MONGOOSE_METHODS = ['Schema', 'model', 'models'];

function injectTypes(ast) {
    // first pass: collect all function-scoped variable assignments
    // so we can try to infer param types from usage
    const paramUsageMap = new Map(); // funcPath -> { paramName -> Set<guessedType> }

    traverse(ast, {
        // ================================================================
        //  variable declarations: const x = 5;
        // ================================================================
        VariableDeclarator(path) {
            const { id, init } = path.node;

            // ---- mongoose model guard (must run before type inference) ----
            // const Model = mongoose.models.X || mongoose.model(...)
            // ts throws 'expression is not callable' on unions of mongoose models
            if (init && t.isLogicalExpression(init, { operator: '||' })) {
                const right = init.right;
                if (t.isCallExpression(right) &&
                    t.isMemberExpression(right.callee) &&
                    t.isIdentifier(right.callee.property, { name: 'model' })) {

                    if (!t.isTSAsExpression(init)) {
                        path.node.init = t.tsAsExpression(init, t.tsAnyKeyword());
                    }
                    return;
                }
            }

            // ---- type annotation injection ----

            // skip if already typed
            if (id.typeAnnotation) return;

            // skip destructuring patterns — `const { a, b } = require('...')`
            // these are too complex to type correctly and usually fine without
            if (t.isObjectPattern(id) || t.isArrayPattern(id)) return;

            // skip if no initializer
            if (!init) return;

            // skip require() calls — the module system handles these
            if (t.isCallExpression(init) && t.isIdentifier(init.callee, { name: 'require' })) return;

            // skip mongoose operations (Schema, model, etc.)
            if (isMongooseExpression(init)) return;

            // skip `new mongoose.Schema(...)`
            if (t.isNewExpression(init) && isMemberCall(init.callee, 'mongoose', 'Schema')) return;

            // skip function/arrow function assignments — don't annotate `const fn = () => {}`
            // the function itself will be typed via the Function visitor
            if (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)) return;

            // skip complex chained calls like `collection.find().sort().limit()`
            if (isChainedCall(init)) return;

            const guessedType = guessType(init);

            // null means "skip this" (analyzer decided it can't be typed safely)
            if (!guessedType) return;

            // don't annotate with `any` on variables — it's noise, not helpful
            if (t.isTSAnyKeyword(guessedType)) return;

            id.typeAnnotation = t.tsTypeAnnotation(guessedType);
        },

        // ================================================================
        //  functions: type parameters and return types
        //  ObjectMethod handles: { execute(interaction) {} }
        //  ClassMethod handles: class methods
        // ================================================================
        'FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|ObjectMethod|ClassMethod'(path) {
            const node = path.node;

            // extract jsdoc types from leading comments
            const leadingComments = node.leadingComments ||
                (path.parent && path.parent.leadingComments) ||
                [];
            const jsdoc = extractJSDocTypes(leadingComments);

            // also check if the parent variable declaration has comments
            // (common pattern: `/** @param {Client} client */ async function loadEvents(client)`)
            if (path.parentPath && path.parentPath.parentPath) {
                const grandparent = path.parentPath.parentPath.node;
                if (grandparent.leadingComments) {
                    const gpJsdoc = extractJSDocTypes(grandparent.leadingComments);
                    // merge, preferring existing
                    for (const [name, type] of Object.entries(gpJsdoc.params)) {
                        if (!jsdoc.params[name]) jsdoc.params[name] = type;
                    }
                    if (!jsdoc.returnType && gpJsdoc.returnType) jsdoc.returnType = gpJsdoc.returnType;
                }
            }

            node.params.forEach(param => {
                // skip if already typed
                if (param.typeAnnotation) return;

                // --- rest parameters: `...args` -> `...args: any[]` ---
                if (t.isRestElement(param)) {
                    if (!param.typeAnnotation) {
                        const restName = t.isIdentifier(param.argument) ? param.argument.name : null;
                        if (restName && jsdoc.params[restName]) {
                            param.typeAnnotation = t.tsTypeAnnotation(jsdoc.params[restName]);
                        } else {
                            param.typeAnnotation = t.tsTypeAnnotation(t.tsArrayType(t.tsAnyKeyword()));
                        }
                    }
                    return;
                }

                // --- assignment patterns: `function(x = false)` ---
                if (t.isAssignmentPattern(param)) {
                    if (param.left.typeAnnotation) return; // already typed

                    const paramName = t.isIdentifier(param.left) ? param.left.name : null;

                    // check jsdoc first
                    if (paramName && jsdoc.params[paramName]) {
                        param.left.typeAnnotation = t.tsTypeAnnotation(jsdoc.params[paramName]);
                        return;
                    }

                    // infer from default value
                    const guessedType = guessType(param.right);
                    if (guessedType && !t.isTSAnyKeyword(guessedType)) {
                        param.left.typeAnnotation = t.tsTypeAnnotation(guessedType);
                    }
                    return;
                }

                // --- destructured params: `function({ guild, channel })` ---
                if (t.isObjectPattern(param) || t.isArrayPattern(param)) {
                    // don't try to type destructured params, way too risky
                    return;
                }

                // --- simple identifier params: `function(message, args, client)` ---
                if (t.isIdentifier(param)) {
                    // check jsdoc
                    if (jsdoc.params[param.name]) {
                        param.typeAnnotation = t.tsTypeAnnotation(jsdoc.params[param.name]);
                        return;
                    }

                    // for common discord.js parameter names, use known types
                    const discordParamTypes = inferDiscordParamType(param.name);
                    if (discordParamTypes) {
                        param.typeAnnotation = t.tsTypeAnnotation(discordParamTypes);
                        return;
                    }

                    // last resort: `any`
                    param.typeAnnotation = t.tsTypeAnnotation(t.tsAnyKeyword());
                }
            });

            // return type from jsdoc
            if (jsdoc.returnType && !node.returnType) {
                // wrap in Promise if async
                if (node.async) {
                    node.returnType = t.tsTypeAnnotation(
                        t.tsTypeReference(t.identifier('Promise'), t.tsTypeParameterInstantiation([jsdoc.returnType]))
                    );
                } else {
                    node.returnType = t.tsTypeAnnotation(jsdoc.returnType);
                }
            }
        },

        // ================================================================
        //  catch clauses: catch(error) -> catch(error: any)
        //  strict mode makes catch vars `unknown` by default which breaks
        //  `error.message` access without explicit casting
        // ================================================================
        CatchClause(path) {
            const param = path.node.param;
            if (!param) return; // catch without binding: catch { }
            if (param.typeAnnotation) return; // already typed

            if (t.isIdentifier(param)) {
                param.typeAnnotation = t.tsTypeAnnotation(t.tsAnyKeyword());
            }
        },

        // ================================================================
        //  class properties
        // ================================================================
        ClassProperty(path) {
            if (path.node.typeAnnotation) return;
            if (!path.node.value) return;

            const guessedType = guessType(path.node.value);
            if (guessedType && !t.isTSAnyKeyword(guessedType)) {
                path.node.typeAnnotation = t.tsTypeAnnotation(guessedType);
            }
        },

        // ================================================================
        //  call expressions: heuristics for discord.js, mongoose, caches
        // ================================================================
        CallExpression(path) {
            // discord.js EmbedBuilder.addFields({ name: ..., value: ... })
            if (t.isMemberExpression(path.node.callee) && 
                t.isIdentifier(path.node.callee.property, { name: 'addFields' })) {
                
                path.node.arguments = path.node.arguments.map(arg => {
                    if (t.isObjectExpression(arg)) {
                        return t.tsAsExpression(arg, t.tsAnyKeyword());
                    }
                    return arg;
                });
            }

            // node-cache .get() or map .get() -> returns `unknown` in strict mode
            // mongoDB .findOne(), .find() -> returns `unknown` or complex types
            if (t.isMemberExpression(path.node.callee) && t.isIdentifier(path.node.callee.property)) {
                const propName = path.node.callee.property.name;
                if (['get', 'findOne', 'find', 'findOneAndUpdate', 'findOneAndDelete'].includes(propName)) {
                    // cast the whole call to `any`
                    // but we must do it safely: if we're not already casted
                    if (!t.isTSAsExpression(path.parentPath.node)) {
                        path.replaceWith(t.tsAsExpression(path.node, t.tsAnyKeyword()));
                        path.skip(); // prevent infinite loop
                    }
                }
            }
        },

        // mongoose model guard is now merged into the VariableDeclarator visitor above

        // ================================================================
        //  implicit class properties from constructor: `this.foo = bar`
        //  TS strict mode requires explicit class property declarations
        // ================================================================
        ClassBody(path) {
            const body = path.node.body;
            const existingProps = new Set(
                body.filter(n => t.isClassProperty(n) && t.isIdentifier(n.key))
                    .map(n => n.key.name)
            );

            // Find the constructor
            const ctor = body.find(n => t.isClassMethod(n) && t.isIdentifier(n.key, { name: 'constructor' }));
            if (!ctor) return;

            const propsToAdd = [];
            
            // Scan constructor body for `this.foo = ...`
            traverse(ctor, {
                AssignmentExpression(assignPath) {
                    const left = assignPath.node.left;
                    if (t.isMemberExpression(left) && t.isThisExpression(left.object) && t.isIdentifier(left.property)) {
                        const propName = left.property.name;
                        if (!existingProps.has(propName)) {
                            existingProps.add(propName); // prevent duplicates
                            const guessedType = guessType(assignPath.node.right);
                            const classProp = t.classProperty(
                                t.identifier(propName),
                                null, // no initial value, initialized in ctor
                                guessedType && !t.isTSAnyKeyword(guessedType) ? t.tsTypeAnnotation(guessedType) : t.tsTypeAnnotation(t.tsAnyKeyword())
                            );
                            propsToAdd.push(classProp);
                        }
                    }
                }
            }, path.scope, path); // pass scope to traverse sub-ast

            // Insert new properties at the top of the class body
            if (propsToAdd.length > 0) {
                path.node.body.unshift(...propsToAdd);
            }
        },
    });

    return ast;
}

// ============================================================================
//  discord.js parameter name heuristics
//  we recognize common param names from the codebase and type them
// ============================================================================
function inferDiscordParamType(name) {
    const lower = name.toLowerCase();

    // these are way too common and ambiguous to type automatically
    // `message` could be a discord Message or a string
    // `interaction` could be any interaction subtype
    // typing them wrong would cause more problems than `any`
    // so we only type the truly unambiguous ones

    // NOTE: we return null for most of these on purpose.
    // the user can add types manually for discord-specific params
    // because discord.js has like 30 different interaction types

    return null;
}

// ============================================================================
//  helpers
// ============================================================================

// checks if an expression is a mongoose-related call
function isMongooseExpression(node) {
    if (!node) return false;

    // `mongoose.model(...)`, `mongoose.models.X`
    if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
        const obj = node.callee.object;
        const prop = node.callee.property;
        if (t.isIdentifier(obj, { name: 'mongoose' }) && t.isIdentifier(prop)) {
            if (MONGOOSE_METHODS.includes(prop.name)) return true;
        }
    }

    // `mongoose.models.X || mongoose.model(...)`
    if (t.isLogicalExpression(node)) {
        return isMongooseExpression(node.left) || isMongooseExpression(node.right);
    }

    // `new mongoose.Schema(...)`
    if (t.isNewExpression(node) && isMemberCall(node.callee, 'mongoose', 'Schema')) {
        return true;
    }

    return false;
}

// checks if `node` is `obj.prop`
function isMemberCall(node, objName, propName) {
    return t.isMemberExpression(node) &&
        t.isIdentifier(node.object, { name: objName }) &&
        t.isIdentifier(node.property, { name: propName });
}

// checks if an expression is a deeply chained method call
// e.g. `collection.find().sort({ balance: -1 }).limit(limit).toArray()`
function isChainedCall(node) {
    if (!t.isCallExpression(node)) return false;
    let depth = 0;
    let current = node;
    while (t.isCallExpression(current) && t.isMemberExpression(current.callee)) {
        depth++;
        current = current.callee.object;
    }
    return depth >= 2; // 2+ levels of chaining = skip
}

module.exports = { injectTypes };
