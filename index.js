const fs = require('fs');
const path = require('path');
const { codeToAST } = require('./parser');
const { convertModuleSystem } = require('./converter');
const { injectTypes } = require('./transformer');
const { astToCode } = require('./generator');

// ============================================================================
//  magikk-migrator — the orchestrator
//
//  this is the brain of the operation. it:
//    1. recursively walks the target src/ directory
//    2. finds all .js and .jsx files
//    3. checks if a .ts/.tsx dupe already exists (skips if so)
//    4. creates a backup of the original file
//    5. runs the file through the full pipeline (parse -> analyze -> transform -> generate)
//    6. writes the output as a new .ts/.tsx file
//    7. generates a detailed migration report
//
//  safety features:
//    - backs up every file before touching it
//    - never deletes original .js files (you do that manually when ready)
//    - skips node_modules, .git, dist, build directories
//    - creates a json report of everything it did
//    - handles errors per-file so one broken file doesn't kill the whole run
// ============================================================================

// --- pretty console output ---
const C = {
    reset:   '\x1b[0m',
    bold:    '\x1b[1m',
    dim:     '\x1b[2m',
    red:     '\x1b[31m',
    green:   '\x1b[32m',
    yellow:  '\x1b[33m',
    blue:    '\x1b[34m',
    magenta: '\x1b[35m',
    cyan:    '\x1b[36m',
    white:   '\x1b[37m',
    bgMagenta: '\x1b[45m',
};

const BANNER = `
${C.magenta}${C.bold}
    ╔══════════════════════════════════════════════════════════╗
    ║                                                          ║
    ║   ✨  M A G I K K   M I G R A T O R  ✨                ║
    ║                                                          ║
    ║   js → ts transpilation engine                           ║
    ║   powered by babel ast manipulation                      ║
    ║                                                          ║
    ╚══════════════════════════════════════════════════════════╝
${C.reset}`;

const LOG = {
    info:    (...args) => console.log(`${C.cyan}[INFO]${C.reset}`, ...args),
    success: (...args) => console.log(`${C.green}[✓]${C.reset}`, ...args),
    warn:    (...args) => console.log(`${C.yellow}[⚠]${C.reset}`, ...args),
    error:   (...args) => console.log(`${C.red}[✗]${C.reset}`, ...args),
    step:    (...args) => console.log(`${C.magenta}[→]${C.reset}`, ...args),
    detail:  (...args) => console.log(`${C.dim}   ${C.reset}`, ...args),
};

// directories to never enter
const IGNORE_DIRS = new Set([
    'node_modules', '.git', 'dist', 'build', '.next',
    'coverage', '.nyc_output', '__pycache__', '.cache',
    'magikk-migrator', // don't migrate ourselves lol
]);

// files to never touch
const IGNORE_FILES = new Set([
    'babel.config.js', '.eslintrc.js', 'jest.config.js',
    'webpack.config.js', 'rollup.config.js', 'vite.config.js',
    'tailwind.config.js', 'postcss.config.js', 'next.config.js',
]);

// ============================================================================
//  recursive directory walker
// ============================================================================
function walkSync(dir, filelist = []) {
    if (!fs.existsSync(dir)) return filelist;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (IGNORE_DIRS.has(entry.name)) continue;
            walkSync(fullPath, filelist);
        } else if (entry.isFile()) {
            filelist.push(fullPath);
        }
    }

    return filelist;
}

// ============================================================================
//  the pipeline — process a single file
// ============================================================================
function migrateFile(filePath, backupDir) {
    const fileName = path.basename(filePath);
    const relativePath = path.relative(process.cwd(), filePath);
    const isJsx = filePath.endsWith('.jsx');
    const tsExt = isJsx ? '.tsx' : '.ts';
    const tsFilePath = filePath.replace(/\.jsx?$/, tsExt);

    const result = {
        source: relativePath,
        target: path.relative(process.cwd(), tsFilePath),
        status: 'unknown',
        errors: [],
        warnings: [],
        stats: { typesInjected: 0 },
    };

    // --- check 1: does a .ts dupe already exist? ---
    if (fs.existsSync(tsFilePath)) {
        // check if it's an empty placeholder file
        const tsContent = fs.readFileSync(tsFilePath, 'utf-8').trim();
        if (tsContent.length > 0) {
            result.status = 'skipped-existing';
            result.warnings.push('ts file already exists with content');
            LOG.warn(`skipping ${C.yellow}${fileName}${C.reset} — ts dupe exists with content`);
            return result;
        }
        // it's an empty placeholder, we can overwrite it
        LOG.detail(`existing ${tsExt} is empty, will overwrite`);
    }

    // --- check 2: is this a config file we shouldn't touch? ---
    if (IGNORE_FILES.has(fileName)) {
        result.status = 'skipped-config';
        LOG.warn(`skipping config file ${C.yellow}${fileName}${C.reset}`);
        return result;
    }

    // --- read the source ---
    let rawCode;
    try {
        rawCode = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
        result.status = 'error-read';
        result.errors.push(`failed to read: ${err.message}`);
        LOG.error(`can't read ${fileName}: ${err.message}`);
        return result;
    }

    // re-exports (like AntiSpam.js) are now handled by the converter
    // no special case needed anymore

    // --- backup the original ---
    try {
        const backupPath = path.join(backupDir, relativePath);
        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
        fs.copyFileSync(filePath, backupPath);
    } catch (err) {
        result.warnings.push(`backup failed: ${err.message}`);
        LOG.warn(`backup failed for ${fileName}: ${err.message}`);
    }

    // --- step 1: parse ---
    LOG.step(`parsing ${C.cyan}${fileName}${C.reset}`);
    const { ast, errors: parseErrors } = codeToAST(rawCode, { isReact: isJsx, filePath });

    if (!ast) {
        result.status = 'error-parse';
        result.errors = parseErrors;
        LOG.error(`fatal parse error in ${fileName}`);
        parseErrors.forEach(e => LOG.detail(`line ${e.line || '?'}: ${e.message}`));
        return result;
    }

    if (parseErrors.length > 0) {
        result.warnings.push(...parseErrors.map(e => `parse warning at line ${e.line}: ${e.message}`));
        LOG.warn(`${parseErrors.length} parse warning(s) in ${fileName} (recovered)`);
    }

    // --- step 2: convert module system (require -> import, module.exports -> export) ---
    LOG.step(`converting ${C.cyan}${fileName}${C.reset} module system`);
    try {
        convertModuleSystem(ast);
    } catch (err) {
        result.warnings.push(`module conversion warning: ${err.message}`);
        LOG.warn(`module conversion issue in ${fileName}: ${err.message} (continuing anyway)`);
    }

    // --- step 3: transform (inject types) ---
    LOG.step(`transforming ${C.cyan}${fileName}${C.reset}`);
    try {
        injectTypes(ast);
    } catch (err) {
        result.status = 'error-transform';
        result.errors.push(`transform error: ${err.message}`);
        LOG.error(`transform failed for ${fileName}: ${err.message}`);
        return result;
    }

    // --- step 4: generate output code ---
    LOG.step(`generating ${C.cyan}${path.basename(tsFilePath)}${C.reset}`);
    let outputCode;
    try {
        outputCode = astToCode(ast);
    } catch (err) {
        result.status = 'error-generate';
        result.errors.push(`generator error: ${err.message}`);
        LOG.error(`code generation failed for ${fileName}: ${err.message}`);
        return result;
    }

    // --- step 5: write the ts file ---
    try {
        fs.writeFileSync(tsFilePath, outputCode, 'utf-8');
        result.status = 'migrated';
        LOG.success(`${C.green}${fileName}${C.reset} → ${C.bold}${path.basename(tsFilePath)}${C.reset}`);
    } catch (err) {
        result.status = 'error-write';
        result.errors.push(`write error: ${err.message}`);
        LOG.error(`failed to write ${path.basename(tsFilePath)}: ${err.message}`);
    }

    return result;
}

// ============================================================================
//  main entry point
// ============================================================================
function run() {
    console.log(BANNER);

    // resolve target directory
    const targetDir = path.resolve(__dirname, '../src');
    const backupDir = path.resolve(__dirname, 'backups', new Date().toISOString().replace(/[:.]/g, '-'));
    const reportPath = path.resolve(__dirname, 'migration-report.json');

    LOG.info(`target: ${C.bold}${targetDir}${C.reset}`);
    LOG.info(`backups: ${C.bold}${backupDir}${C.reset}`);
    LOG.info('');

    if (!fs.existsSync(targetDir)) {
        LOG.error(`target directory not found: ${targetDir}`);
        process.exit(1);
    }

    // create backup directory
    fs.mkdirSync(backupDir, { recursive: true });

    // find all js/jsx files
    const allFiles = walkSync(targetDir);
    const jsFiles = allFiles.filter(f => f.endsWith('.js') || f.endsWith('.jsx'));

    LOG.info(`found ${C.bold}${allFiles.length}${C.reset} total files`);
    LOG.info(`found ${C.bold}${jsFiles.length}${C.reset} javascript files to process`);
    LOG.info('');
    LOG.info(`${C.magenta}═══════════════════════════════════════════${C.reset}`);
    LOG.info('');

    // process each file
    const results = [];
    const startTime = Date.now();

    for (let i = 0; i < jsFiles.length; i++) {
        const file = jsFiles[i];
        const progress = `[${i + 1}/${jsFiles.length}]`;
        LOG.info(`${C.dim}${progress}${C.reset} processing ${C.cyan}${path.relative(targetDir, file)}${C.reset}`);
        
        const result = migrateFile(file, backupDir);
        results.push(result);
        console.log('');
    }

    // generate summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    const migrated = results.filter(r => r.status === 'migrated' || r.status === 'migrated-reexport').length;
    const skipped = results.filter(r => r.status.startsWith('skipped')).length;
    const errors = results.filter(r => r.status.startsWith('error')).length;

    console.log('');
    LOG.info(`${C.magenta}═══════════════════════════════════════════${C.reset}`);
    console.log('');
    LOG.info(`${C.bold}migration complete!${C.reset} (${elapsed}s)`);
    LOG.info(`  ${C.green}✓ migrated:${C.reset} ${migrated}`);
    LOG.info(`  ${C.yellow}⚠ skipped:${C.reset}  ${skipped}`);
    LOG.info(`  ${C.red}✗ errors:${C.reset}   ${errors}`);
    LOG.info(`  📦 backups:  ${backupDir}`);

    // save report
    try {
        const report = {
            timestamp: new Date().toISOString(),
            targetDir,
            backupDir,
            elapsedSeconds: parseFloat(elapsed),
            summary: { total: jsFiles.length, migrated, skipped, errors },
            files: results,
        };
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        LOG.info(`  📋 report:   ${reportPath}`);
    } catch (err) {
        LOG.warn(`failed to save report: ${err.message}`);
    }

    console.log('');
    if (errors > 0) {
        LOG.warn(`${errors} file(s) had errors. check the report for details.`);
        LOG.warn(`your original .js files are untouched — the .ts files are new additions.`);
    }

    LOG.info(`${C.magenta}${C.bold}magikk complete ✨${C.reset}`);
    console.log('');
}

run();
