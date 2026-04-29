const t = require('@babel/types');

// ============================================================================
//  analyzer — the type inference detective
//
//  this is where all the magic happens. we look at how values are used
//  and assigned, then deduce what type they should be. each function here
//  handles a specific pattern found in the actual codebase.
//
//  the goal is NEVER to produce wrong types. if we aren't confident,
//  we fall back to `any` — which is annoying but never breaks code.
//  a wrong type (like saying something is `string` when it's actually
//  `number`) would silently introduce bugs that surface days later.
// ============================================================================

// ----------------------------------------------------------------------------
//  core: guess the type from an ast node (a value/expression)
// ----------------------------------------------------------------------------
function guessType(node) {
    if (!node) return t.tsAnyKeyword();

    // --- literals: the easiest wins ---
    if (t.isStringLiteral(node) || t.isTemplateLiteral(node)) return t.tsStringKeyword();
    if (t.isNumericLiteral(node))  return t.tsNumberKeyword();
    if (t.isBooleanLiteral(node))  return t.tsBooleanKeyword();
    // null literals: don't annotate as `: null` because that prevents reassignment
    // `let x: null = null` means x can ONLY ever be null — useless and wrong
    if (t.isNullLiteral(node))     return null; // null = skip annotation
    if (t.isRegExpLiteral(node))   return t.tsTypeReference(t.identifier('RegExp'));

    // --- array expressions: try to infer element types ---
    if (t.isArrayExpression(node)) {
        return guessArrayType(node);
    }

    // --- object literals ---
    // typing as Record<string, any> prevents 'Element implicitly has any type'
    // when accessing properties dynamically via bracket notation
    if (t.isObjectExpression(node)) {
        return t.tsTypeReference(
            t.identifier('Record'),
            t.tsTypeParameterInstantiation([
                t.tsStringKeyword(),
                t.tsAnyKeyword()
            ])
        );
    }

    // --- new expressions: `new Map()`, `new Set()`, `new Collection()` etc ---
    if (t.isNewExpression(node)) {
        return guessNewExpressionType(node);
    }

    // --- call expressions: `require()`, `Date.now()`, `Array.from()`, etc ---
    if (t.isCallExpression(node)) {
        return guessCallExpressionType(node);
    }

    // --- arrow / function expressions ---
    if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) {
        // don't try to type function values, just leave them
        return null; // null = "skip this, don't annotate"
    }

    // --- unary expressions like `!something` ---
    if (t.isUnaryExpression(node) && node.operator === '!') {
        return t.tsBooleanKeyword();
    }

    // --- binary expressions: math ops return number, comparisons return boolean ---
    if (t.isBinaryExpression(node)) {
        const mathOps = ['+', '-', '*', '/', '%', '**', '|', '&', '^', '<<', '>>', '>>>'];
        const boolOps = ['===', '!==', '==', '!=', '<', '>', '<=', '>=', 'instanceof', 'in'];
        if (boolOps.includes(node.operator)) return t.tsBooleanKeyword();
        // + could be string concatenation, so only if both sides look numeric
        if (node.operator === '+') {
            const leftType = guessType(node.left);
            const rightType = guessType(node.right);
            if (leftType && rightType &&
                t.isTSNumberKeyword(leftType) && t.isTSNumberKeyword(rightType)) {
                return t.tsNumberKeyword();
            }
            return t.tsAnyKeyword(); // could be string concat
        }
        if (mathOps.includes(node.operator)) return t.tsNumberKeyword();
    }

    // --- logical expressions: || or ?? with a clear type ---
    if (t.isLogicalExpression(node)) {
        // for `a || 'default'`, try to infer from the right side
        const rightType = guessType(node.right);
        if (rightType && !t.isTSAnyKeyword(rightType)) return rightType;
        const leftType = guessType(node.left);
        if (leftType && !t.isTSAnyKeyword(leftType)) return leftType;
    }

    // --- conditional (ternary): `cond ? a : b` ---
    if (t.isConditionalExpression(node)) {
        const consType = guessType(node.consequent);
        const altType = guessType(node.alternate);
        // if both sides are the same type, use that
        if (consType && altType && typesMatch(consType, altType)) return consType;
        return t.tsAnyKeyword();
    }

    // --- await expressions: unwrap and guess the inner type ---
    if (t.isAwaitExpression(node)) {
        return guessType(node.argument);
    }

    // --- member expressions like `process.env.X` ---
    if (t.isMemberExpression(node)) {
        return guessPropertyAccessType(node);
    }

    // --- assignment expressions (x = value) ---
    if (t.isAssignmentExpression(node)) {
        return guessType(node.right);
    }

    // we have no idea, be honest about it
    return t.tsAnyKeyword();
}

// ----------------------------------------------------------------------------
//  array type inference
// ----------------------------------------------------------------------------
function guessArrayType(node) {
    if (!node.elements || node.elements.length === 0) {
        return t.tsArrayType(t.tsAnyKeyword());
    }

    // sample the first few elements to find a consistent type
    const types = node.elements
        .filter(el => el !== null) // sparse arrays have null holes
        .slice(0, 5)
        .map(el => guessType(el))
        .filter(Boolean);

    if (types.length === 0) return t.tsArrayType(t.tsAnyKeyword());

    // check if all sampled types are the same
    const firstType = types[0];
    const allSame = types.every(ty => typesMatch(ty, firstType));

    if (allSame) return t.tsArrayType(firstType);
    return t.tsArrayType(t.tsAnyKeyword());
}

// ----------------------------------------------------------------------------
//  new expression type inference (`new Map()`, `new Set()`, etc.)
// ----------------------------------------------------------------------------
function guessNewExpressionType(node) {
    if (!t.isIdentifier(node.callee)) return t.tsAnyKeyword();

    const name = node.callee.name;

    // known generic constructors — type them properly
    const genericMap = {
        'Map':        () => t.tsTypeReference(t.identifier('Map'), t.tsTypeParameterInstantiation([t.tsAnyKeyword(), t.tsAnyKeyword()])),
        'Set':        () => t.tsTypeReference(t.identifier('Set'), t.tsTypeParameterInstantiation([t.tsAnyKeyword()])),
        'WeakMap':    () => t.tsTypeReference(t.identifier('WeakMap'), t.tsTypeParameterInstantiation([t.tsAnyKeyword(), t.tsAnyKeyword()])),
        'WeakSet':    () => t.tsTypeReference(t.identifier('WeakSet'), t.tsTypeParameterInstantiation([t.tsAnyKeyword()])),
        'Array':      () => t.tsArrayType(t.tsAnyKeyword()),
        'Date':       () => t.tsTypeReference(t.identifier('Date')),
        'RegExp':     () => t.tsTypeReference(t.identifier('RegExp')),
        'Error':      () => t.tsTypeReference(t.identifier('Error')),
        'Promise':    () => t.tsTypeReference(t.identifier('Promise'), t.tsTypeParameterInstantiation([t.tsAnyKeyword()])),
        'Collection': () => t.tsTypeReference(t.identifier('Collection'), t.tsTypeParameterInstantiation([t.tsAnyKeyword(), t.tsAnyKeyword()])),
    };

    if (genericMap[name]) return genericMap[name]();

    // for everything else (e.g. `new MongoClient(uri)`) just reference the constructor name
    return t.tsTypeReference(t.identifier(name));
}

// ----------------------------------------------------------------------------
//  call expression type inference
// ----------------------------------------------------------------------------
function guessCallExpressionType(node) {
    // `require('...')` — don't type this, let the require stay untyped
    // because the actual type depends on what the module exports
    if (t.isIdentifier(node.callee) && node.callee.name === 'require') {
        return null; // null = skip
    }

    // `Date.now()` -> number
    if (t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.object, { name: 'Date' }) &&
        t.isIdentifier(node.callee.property, { name: 'now' })) {
        return t.tsNumberKeyword();
    }

    // `Math.floor()`, `Math.random()`, `Math.max()`, etc -> number
    if (t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.object, { name: 'Math' })) {
        return t.tsNumberKeyword();
    }

    // `parseInt()`, `parseFloat()` -> number
    if (t.isIdentifier(node.callee) &&
        (node.callee.name === 'parseInt' || node.callee.name === 'parseFloat')) {
        return t.tsNumberKeyword();
    }

    // `Array.from(...)` -> any[]
    if (t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.object, { name: 'Array' }) &&
        t.isIdentifier(node.callee.property, { name: 'from' })) {
        return t.tsArrayType(t.tsAnyKeyword());
    }

    // `.toString()` -> string
    if (t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.property, { name: 'toString' })) {
        return t.tsStringKeyword();
    }

    // `.filter()`, `.map()`, `.slice()`, `.concat()` on arrays -> any[]
    if (t.isMemberExpression(node.callee)) {
        const method = node.callee.property;
        if (t.isIdentifier(method)) {
            const arrayMethods = ['filter', 'map', 'slice', 'concat', 'flat', 'flatMap', 'sort', 'reverse'];
            if (arrayMethods.includes(method.name)) {
                // Discord.js Collections share these methods with Arrays.
                // Typing them as `any[]` breaks `.size` checks later.
                // Returning `any` satisfies both arrays and collections.
                return t.tsAnyKeyword();
            }
            // `.join()` -> string
            if (method.name === 'join') return t.tsStringKeyword();
            // `.includes()`, `.some()`, `.every()` -> boolean
            if (['includes', 'some', 'every', 'has'].includes(method.name)) return t.tsBooleanKeyword();
            // `.length` is a property not a call, but `.indexOf()`, `.findIndex()` -> number
            if (['indexOf', 'findIndex', 'push', 'unshift'].includes(method.name)) return t.tsNumberKeyword();
            // `.find()` -> could be anything
            if (method.name === 'find') return t.tsAnyKeyword();
        }
    }

    // default: we don't know what a random function returns
    return t.tsAnyKeyword();
}

// ----------------------------------------------------------------------------
//  property access type inference
// ----------------------------------------------------------------------------
function guessPropertyAccessType(node) {
    // `process.env.SOMETHING` -> string | undefined
    if (t.isMemberExpression(node.object) &&
        t.isIdentifier(node.object.object, { name: 'process' }) &&
        t.isIdentifier(node.object.property, { name: 'env' })) {
        return t.tsUnionType([t.tsStringKeyword(), t.tsUndefinedKeyword()]);
    }

    // `.length` -> number
    if (t.isIdentifier(node.property, { name: 'length' }) || t.isIdentifier(node.property, { name: 'size' })) {
        return t.tsNumberKeyword();
    }

    // `.id` on discord objects is always a string (snowflake)
    if (t.isIdentifier(node.property, { name: 'id' })) {
        return t.tsStringKeyword();
    }

    return t.tsAnyKeyword();
}

// ----------------------------------------------------------------------------
//  jsdoc type extraction
//  reads `@param {Type} name` and `@returns {Type}` from comment blocks
// ----------------------------------------------------------------------------
function extractJSDocTypes(comments) {
    const result = { params: {}, returnType: null };
    if (!comments || !Array.isArray(comments)) return result;

    for (const comment of comments) {
        if (comment.type !== 'CommentBlock') continue;
        const text = comment.value;

        // extract @param {Type} name
        const paramMatches = text.matchAll(/@param\s+\{([^}]+)\}\s+(\w+)/g);
        for (const match of paramMatches) {
            result.params[match[2]] = jsdocTypeToTSType(match[1]);
        }

        // extract @returns {Type} or @return {Type}
        const returnMatch = text.match(/@returns?\s+\{([^}]+)\}/);
        if (returnMatch) {
            result.returnType = jsdocTypeToTSType(returnMatch[1]);
        }
    }

    return result;
}

// converts a jsdoc type string to a babel ts type node
function jsdocTypeToTSType(jsdocType) {
    const cleaned = jsdocType.trim();

    // handle import() types like `import('discord.js').Client`
    const importMatch = cleaned.match(/^import\(['"]([^'"]+)['"]\)\.(\w+)$/);
    if (importMatch) {
        return t.tsTypeReference(t.identifier(importMatch[2]));
    }

    // basic type mapping
    const typeMap = {
        'string':    () => t.tsStringKeyword(),
        'number':    () => t.tsNumberKeyword(),
        'boolean':   () => t.tsBooleanKeyword(),
        'void':      () => t.tsVoidKeyword(),
        'null':      () => t.tsNullKeyword(),
        'undefined': () => t.tsUndefinedKeyword(),
        'any':       () => t.tsAnyKeyword(),
        'never':     () => t.tsNeverKeyword(),
        'object':    () => t.tsObjectKeyword(),
        'Object':    () => t.tsObjectKeyword(),
        'Function':  () => t.tsTypeReference(t.identifier('Function')),
        'Array':     () => t.tsArrayType(t.tsAnyKeyword()),
        'Promise':   () => t.tsTypeReference(t.identifier('Promise'), t.tsTypeParameterInstantiation([t.tsAnyKeyword()])),
    };

    if (typeMap[cleaned]) return typeMap[cleaned]();

    // array notation: `string[]`
    if (cleaned.endsWith('[]')) {
        const innerType = jsdocTypeToTSType(cleaned.slice(0, -2));
        return t.tsArrayType(innerType);
    }

    // union types: `string|number`
    if (cleaned.includes('|')) {
        const parts = cleaned.split('|').map(p => jsdocTypeToTSType(p.trim()));
        return t.tsUnionType(parts);
    }

    // anything else — treat as a named type reference
    return t.tsTypeReference(t.identifier(cleaned));
}

// ----------------------------------------------------------------------------
//  utility: check if two ts type nodes are structurally the same
// ----------------------------------------------------------------------------
function typesMatch(a, b) {
    if (!a || !b) return false;
    if (a.type !== b.type) return false;

    // for keywords (TSStringKeyword, TSNumberKeyword, etc.), type match is enough
    if (a.type.startsWith('TS') && a.type.endsWith('Keyword')) return true;

    // for type references, compare the identifier name
    if (t.isTSTypeReference(a) && t.isTSTypeReference(b)) {
        if (t.isIdentifier(a.typeName) && t.isIdentifier(b.typeName)) {
            return a.typeName.name === b.typeName.name;
        }
    }

    // for arrays, compare element types
    if (t.isTSArrayType(a) && t.isTSArrayType(b)) {
        return typesMatch(a.elementType, b.elementType);
    }

    return false;
}

module.exports = {
    guessType,
    guessArrayType,
    guessNewExpressionType,
    guessCallExpressionType,
    guessPropertyAccessType,
    extractJSDocTypes,
    jsdocTypeToTSType,
    typesMatch,
};
