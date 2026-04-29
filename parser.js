const { parse } = require('@babel/parser');

// ============================================================================
//  parser — turns raw javascript into an abstract syntax tree
//
//  we enable every relevant babel plugin so we can handle literally anything
//  the codebase throws at us: optional chaining, nullish coalescing, class
//  properties, dynamic imports, decorators, etc.
//
//  the "errorRecovery" flag is critical — if babel hits a syntax it doesn't
//  understand, it will keep going instead of crashing the entire pipeline.
//  we collect those errors and report them so the user knows what happened.
// ============================================================================

const PLUGINS = [
    'jsx',
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'optionalChaining',
    'nullishCoalescingOperator',
    'dynamicImport',
    'exportDefaultFrom',
    'exportNamespaceFrom',
    'objectRestSpread',
    'asyncGenerators',
    'optionalCatchBinding',
    'throwExpressions',
    'logicalAssignment',
    'numericSeparator',
    'topLevelAwait',
];

// parses raw js/jsx code into an ast
// returns { ast, errors } so the caller can decide what to do with partial failures
function codeToAST(code, options = {}) {
    const { isReact = false, filePath = 'unknown' } = options;

    // always include jsx plugin — even non-react files might have jsx-like syntax
    // and it doesn't hurt to have it enabled
    const plugins = [...PLUGINS];

    try {
        const ast = parse(code, {
            sourceType: 'module',
            allowImportExportEverywhere: true,  // some files use require() mixed with import
            allowReturnOutsideFunction: true,   // node scripts sometimes have top-level return
            allowSuperOutsideMethod: true,      // edge case safety
            errorRecovery: true,                // DON'T crash on weird syntax, collect errors
            plugins,
        });

        // babel stores recovered errors in ast.errors
        const errors = (ast.errors || []).map(e => ({
            message: e.message,
            line: e.loc?.line,
            column: e.loc?.column,
        }));

        return { ast, errors };
    } catch (err) {
        // if even error recovery can't save us, return null ast with the fatal error
        return {
            ast: null,
            errors: [{ message: err.message, line: err.loc?.line, column: err.loc?.column, fatal: true }],
        };
    }
}

module.exports = { codeToAST };
