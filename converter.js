const traverse = require('@babel/traverse').default;
const t = require('@babel/types');

// ============================================================================
//  converter — transforms commonjs to esm syntax
//
//  this is the module that converts:
//    const { X, Y } = require('module')  →  import { X, Y } from 'module'
//    const X = require('module')         →  import X from 'module'
//    module.exports = { a, b, c }        →  export { a, b, c }
//    module.exports = X                  →  export default X
//    require('dotenv').config()          →  stays as-is (side effect)
//
//  why this matters:
//    typescript treats files without import/export as "scripts" where all
//    top-level declarations are GLOBAL. so if two files both do
//    `const { EmbedBuilder } = require('discord.js')`, typescript sees them
//    as redeclaring the same global variable. converting to import syntax
//    makes each file a proper module with its own scope.
//
//    bonus: import syntax also imports the TYPE information, so
//    `new AttachmentBuilder(...)` is recognized as an instance type.
// ============================================================================

function convertModuleSystem(ast) {
    const importsToAdd = [];
    const pathsToRemove = [];
    let hasModuleExports = false;

    traverse(ast, {
        // ================================================================
        //  pass 1: find require() calls and queue them for conversion
        // ================================================================
        VariableDeclaration(path) {
            // only convert top-level requires (not inside functions)
            if (!path.parentPath.isProgram()) return;

            const declarations = path.node.declarations;
            if (declarations.length !== 1) return;

            const decl = declarations[0];
            if (!decl.init) return;

            // --- pattern: const X = require('module') ---
            if (t.isCallExpression(decl.init) &&
                t.isIdentifier(decl.init.callee, { name: 'require' }) &&
                decl.init.arguments.length === 1 &&
                t.isStringLiteral(decl.init.arguments[0])) {

                const source = decl.init.arguments[0].value;

                // destructured: const { A, B } = require('module')
                if (t.isObjectPattern(decl.id)) {
                    const specifiers = [];
                    for (const prop of decl.id.properties) {
                        if (t.isRestElement(prop)) continue; // can't import rest
                        if (!t.isObjectProperty(prop)) continue;

                        const imported = t.isIdentifier(prop.key) ? prop.key : null;
                        const local = t.isIdentifier(prop.value) ? prop.value : null;
                        if (!imported || !local) continue;

                        specifiers.push(t.importSpecifier(
                            t.identifier(local.name),
                            t.identifier(imported.name)
                        ));
                    }

                    if (specifiers.length > 0) {
                        importsToAdd.push({
                            node: t.importDeclaration(specifiers, t.stringLiteral(source)),
                            path: path,
                        });
                        pathsToRemove.push(path);
                    }
                    return;
                }

                // default: const X = require('module')
                if (t.isIdentifier(decl.id)) {
                    importsToAdd.push({
                        node: t.importDeclaration(
                            [t.importDefaultSpecifier(t.identifier(decl.id.name))],
                            t.stringLiteral(source)
                        ),
                        path: path,
                    });
                    pathsToRemove.push(path);
                    return;
                }
            }

            // --- pattern: const { X } = require('module').something ---
            // e.g. const { BOT_ID } = process.env — skip these
        },

        // ================================================================
        //  pass 2: find module.exports and convert
        // ================================================================
        ExpressionStatement(path) {
            if (!path.parentPath.isProgram()) return;

            const expr = path.node.expression;
            if (!t.isAssignmentExpression(expr)) return;

            // check for module.exports = ... or module.exports.X = ...
            if (!t.isMemberExpression(expr.left)) return;
            
            // pattern: module.exports.X = Y
            if (t.isMemberExpression(expr.left.object) && 
                t.isIdentifier(expr.left.object.object, { name: 'module' }) && 
                t.isIdentifier(expr.left.object.property, { name: 'exports' }) &&
                t.isIdentifier(expr.left.property)) {
                
                const propName = expr.left.property.name;
                const right = expr.right;
                
                // if right is an identifier, export { right as propName }
                if (t.isIdentifier(right)) {
                    path.replaceWith(t.exportNamedDeclaration(null, [
                        t.exportSpecifier(t.identifier(right.name), t.identifier(propName))
                    ]));
                } else {
                    // export const propName = right
                    path.replaceWith(t.exportNamedDeclaration(
                        t.variableDeclaration('const', [
                            t.variableDeclarator(t.identifier(propName), right)
                        ]),
                        []
                    ));
                }
                return;
            }

            // pattern: module.exports = ...
            if (!t.isIdentifier(expr.left.object, { name: 'module' })) return;
            if (!t.isIdentifier(expr.left.property, { name: 'exports' })) return;

            hasModuleExports = true;
            const right = expr.right;

            // --- module.exports = require('...') → export-from ---
            if (t.isCallExpression(right) &&
                t.isIdentifier(right.callee, { name: 'require' }) &&
                right.arguments.length === 1 &&
                t.isStringLiteral(right.arguments[0])) {
                // re-export: module.exports = require('./x')
                // convert to: export { default } from './x'
                // actually safer to just do: import _mod from './x'; export default _mod;
                const source = right.arguments[0].value;
                const tempName = '_reexport';
                path.replaceWithMultiple([
                    t.importDeclaration(
                        [t.importDefaultSpecifier(t.identifier(tempName))],
                        t.stringLiteral(source)
                    ),
                    t.exportDefaultDeclaration(t.identifier(tempName)),
                ]);
                return;
            }

            // --- module.exports = { a, b, c } (all shorthand identifiers) ---
            if (t.isObjectExpression(right)) {
                const allIdentifiers = right.properties.every(prop => {
                    if (t.isSpreadElement(prop)) return false;
                    if (!t.isObjectProperty(prop)) return false; // methods etc
                    return true;
                });

                if (allIdentifiers && right.properties.length > 0 &&
                    right.properties.every(p => t.isObjectProperty(p))) {

                    // check if ANY property has a non-identifier value (inline object, function, etc)
                    const hasComplexValues = right.properties.some(prop => {
                        if (!t.isObjectProperty(prop)) return true;
                        // shorthand: { a } where key === value
                        if (prop.shorthand) return false;
                        // renamed: { forceSave: flushDirtyData } — value must be identifier
                        return !t.isIdentifier(prop.value);
                    });

                    if (!hasComplexValues) {
                        // all values are identifiers — use named exports
                        const specifiers = right.properties.map(prop => {
                            const key = t.isIdentifier(prop.key) ? prop.key.name :
                                        t.isStringLiteral(prop.key) ? prop.key.value : null;
                            const val = t.isIdentifier(prop.value) ? prop.value.name : null;
                            if (!key || !val) return null;
                            return t.exportSpecifier(t.identifier(val), t.identifier(key));
                        }).filter(Boolean);

                        if (specifiers.length > 0) {
                            path.replaceWithMultiple([
                                t.exportNamedDeclaration(null, specifiers),
                                t.exportDefaultDeclaration(right)
                            ]);
                            return;
                        }
                    }
                }

                // fallback: module.exports = { ... complex ... } → export default { ... }
                path.replaceWith(t.exportDefaultDeclaration(right));
                return;
            }

            // --- module.exports = SomeIdentifier → export default SomeIdentifier ---
            if (t.isIdentifier(right)) {
                path.replaceWith(t.exportDefaultDeclaration(right));
                return;
            }

            // --- fallback: module.exports = <expression> → export default <expression> ---
            // wrap non-declaration expressions properly
            path.replaceWith(t.exportDefaultDeclaration(right));
        },
    });

    // remove the old require declarations (in reverse order to keep indices valid)
    for (let i = pathsToRemove.length - 1; i >= 0; i--) {
        pathsToRemove[i].remove();
    }

    // insert imports at the top of the file
    if (importsToAdd.length > 0 && ast.program && ast.program.body) {
        const importNodes = importsToAdd.map(i => i.node);
        ast.program.body.unshift(...importNodes);
    }

    return ast;
}

module.exports = { convertModuleSystem };
