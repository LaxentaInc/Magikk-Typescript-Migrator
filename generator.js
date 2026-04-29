const generate = require('@babel/generator').default;

// ============================================================================
//  generator — converts the modified ast back into source code
//
//  we use retainLines to keep the output roughly aligned with the original,
//  and we ALWAYS preserve comments. the `jsescOption` ensures unicode
//  characters (like emoji in discord bot strings) don't get mangled.
// ============================================================================

function astToCode(ast) {
    const output = generate(ast, {
        retainLines: false,     // don't force same line numbers — it creates ugly spacing
        comments: true,         // preserve all comments
        compact: false,         // don't minify
        concise: false,         // full formatting
        jsescOption: {
            minimal: true,      // don't escape unicode — keeps emoji intact
        },
    });
    return output.code;
}

module.exports = { astToCode };
