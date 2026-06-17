#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { Command } from 'commander';
import fg from 'fast-glob';
import pc from 'picocolors';
import { codeToAST } from './parser';
import { convertModuleSystem } from './converter';
import { injectTypes } from './transformer';
import { astToCode } from './generator';
import { refineTypes } from './refiner';
import { runLintFix } from './postprocess';
import type { MigrationResult, MigrationReport } from './types';

// read version from package.json at build time
const PKG_VERSION: string = (() => {
  try {
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
  } catch {
    return '0.0.0';
  }
})();

const BANNER = `
${pc.magenta(pc.bold(`
    ╔══════════════════════════════════════════════════════════╗
    ║                                                          ║
    ║    M T S   M I G R A T O R                               ║
    ║                                                          ║
    ║   js → ts transpilation engine                           ║
    ║   by laxenta inc — https://colorwall.xyz                 ║
    ║                                                          ║
    ╚══════════════════════════════════════════════════════════╝
`))}`;

const LOG = {
  info:    (...args: unknown[]) => console.log(`${pc.cyan('[INFO]')}`, ...args),
  success: (...args: unknown[]) => console.log(`${pc.green('[✓]')}`, ...args),
  warn:    (...args: unknown[]) => console.log(`${pc.yellow('[⚠]')}`, ...args),
  error:   (...args: unknown[]) => console.log(`${pc.red('[✗]')}`, ...args),
  step:    (...args: unknown[]) => console.log(`${pc.magenta('[→]')}`, ...args),
  detail:  (...args: unknown[]) => console.log(`${pc.dim('   ')}`, ...args),
};

const IGNORE_DIRS = [
  'node_modules', '.git', 'dist', 'build', '.next',
  'coverage', '.nyc_output', '__pycache__', '.cache',
  'mts-migrator',
];

const IGNORE_FILES = new Set([
  'babel.config.js', '.eslintrc.js', 'jest.config.js',
  'webpack.config.js', 'rollup.config.js', 'vite.config.js',
  'tailwind.config.js', 'postcss.config.js', 'next.config.js',
  'babel.config.cjs', '.eslintrc.cjs', 'jest.config.cjs',
  'webpack.config.cjs', 'rollup.config.cjs', 'vite.config.cjs',
  'tailwind.config.cjs', 'postcss.config.cjs', 'next.config.cjs',
  'babel.config.mjs', '.eslintrc.mjs', 'jest.config.mjs',
  'webpack.config.mjs', 'rollup.config.mjs', 'vite.config.mjs',
  'tailwind.config.mjs', 'postcss.config.mjs', 'next.config.mjs',
]);

function findTargetDir(baseDir: string, targetName: string): string | null {
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !IGNORE_DIRS.includes(entry.name)) {
        if (entry.name === targetName) {
          return path.join(baseDir, entry.name);
        }
        const found = findTargetDir(path.join(baseDir, entry.name), targetName);
        if (found) return found;
      }
    }
  } catch {
    // ignore read errors
  }
  return null;
}

// resolve the correct ts extension for a given js file
function getTsExtension(filePath: string): string {
  if (filePath.endsWith('.jsx')) return '.tsx';
  if (filePath.endsWith('.mjs')) return '.mts';
  if (filePath.endsWith('.cjs')) return '.cts';
  return '.ts';
}

// find js files using fast-glob instead of hand-rolled recursion
function findJsFiles(dir: string): string[] {
  const ignorePatterns = IGNORE_DIRS.map(d => `**/${d}/**`);

  const files = fg.sync('**/*.{js,jsx,mjs,cjs}', {
    cwd: dir,
    absolute: true,
    ignore: ignorePatterns,
    dot: false,
    onlyFiles: true,
  });

  return files;
}

function migrateFile(filePath: string, backupDir: string, dryRun: boolean, discord: boolean): MigrationResult {
  const fileName = path.basename(filePath);
  const relativePath = path.relative(process.cwd(), filePath);
  const tsExt = getTsExtension(filePath);
  const tsFilePath = filePath.replace(/\.(js|jsx|mjs|cjs)$/, tsExt);

  const result: MigrationResult = {
    source: relativePath,
    target: path.relative(process.cwd(), tsFilePath),
    status: 'unknown',
    errors: [],
    warnings: [],
  };

  // skip if a non-empty ts file already exists
  if (fs.existsSync(tsFilePath)) {
    const tsContent = fs.readFileSync(tsFilePath, 'utf-8').trim();
    if (tsContent.length > 0) {
      result.status = 'skipped-existing';
      result.warnings.push('ts file already exists with content');
      LOG.warn(`skipping ${pc.yellow(fileName)} — ts dupe exists`);
      return result;
    }
    LOG.detail(`existing ${tsExt} is empty, overwriting`);
  }

  // skip config files
  if (IGNORE_FILES.has(fileName)) {
    result.status = 'skipped-config';
    LOG.warn(`skipping config file ${pc.yellow(fileName)}`);
    return result;
  }

  let rawCode: string;
  try {
    rawCode = fs.readFileSync(filePath, 'utf-8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.status = 'error-read';
    result.errors.push(`failed to read: ${msg}`);
    LOG.error(`can't read ${fileName}: ${msg}`);
    return result;
  }

  // backup the original
  try {
    const backupPath = path.join(backupDir, relativePath);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(filePath, backupPath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.warnings.push(`backup failed: ${msg}`);
    LOG.warn(`backup failed for ${fileName}: ${msg}`);
  }

  // step 1: parse
  const isJsx = filePath.endsWith('.jsx');
  LOG.step(`parsing ${pc.cyan(fileName)}`);
  const { ast, errors: parseErrors } = codeToAST(rawCode, { isReact: isJsx, filePath });

  if (!ast) {
    result.status = 'error-parse';
    result.errors = parseErrors.map(e => e.message);
    LOG.error(`fatal parse error in ${fileName}`);
    parseErrors.forEach(e => LOG.detail(`line ${e.line || '?'}: ${e.message}`));
    return result;
  }

  if (parseErrors.length > 0) {
    result.warnings.push(...parseErrors.map(e => `parse warning at line ${e.line}: ${e.message}`));
    LOG.warn(`${parseErrors.length} parse warning(s) in ${fileName} (recovered)`);
  }

  // step 2: convert module system
  LOG.step(`converting ${pc.cyan(fileName)} module system`);
  try {
    convertModuleSystem(ast);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.warnings.push(`module conversion warning: ${msg}`);
    LOG.warn(`module conversion issue in ${fileName}: ${msg} (continuing)`);
  }

  // step 3: inject types
  LOG.step(`transforming ${pc.cyan(fileName)}`);
  try {
    injectTypes(ast, { discordCompat: discord });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.status = 'error-transform';
    result.errors.push(`transform error: ${msg}`);
    LOG.error(`transform failed for ${fileName}: ${msg}`);
    return result;
  }

  // step 4: generate output
  LOG.step(`generating ${pc.cyan(path.basename(tsFilePath))}`);
  let outputCode: string;
  try {
    outputCode = astToCode(ast);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.status = 'error-generate';
    result.errors.push(`generator error: ${msg}`);
    LOG.error(`code generation failed for ${fileName}: ${msg}`);
    return result;
  }

  // step 5: write the ts file (unless dry run)
  if (dryRun) {
    result.status = 'migrated';
    LOG.success(`${pc.green(fileName)} → ${pc.bold(path.basename(tsFilePath))} ${pc.dim('(dry run)')}`);
    return result;
  }

  try {
    fs.writeFileSync(tsFilePath, outputCode, 'utf-8');
    result.status = 'migrated';
    LOG.success(`${pc.green(fileName)} → ${pc.bold(path.basename(tsFilePath))}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.status = 'error-write';
    result.errors.push(`write error: ${msg}`);
    LOG.error(`failed to write ${path.basename(tsFilePath)}: ${msg}`);
  }

  return result;
}

async function run(): Promise<void> {
  const program = new Command();

  program
    .name('mts')
    .description('js → ts migration engine by laxenta inc')
    .version(PKG_VERSION, '-v, --version')
    .argument('[target]', 'target folder name or path to migrate')
    .option('--target <dir>', 'target folder name or path (alternative syntax)')
    .option('--dry-run', 'preview changes without writing files', false)
    .option('--no-refine', 'skip ts-morph type refinement pass')
    .option('--no-lint', 'skip eslint --fix post-processing')
    .option('--discord', 'enable discord.js-specific transforms (setColor, setStyle, addFields casts)', false)
    .addHelpText('after', `
${pc.bold('examples:')}
  pnpm mts                                         migrate the whole working folder
  pnpm mts components                               target the folder named "components"
  pnpm mts --target utils --dry-run                  preview changes without writing
  npx mts-migrator src --no-refine --no-lint         skip refinement and linting
  pnpm mts src --discord                             enable discord.js compat transforms
`);

  program.parse(process.argv);

  const opts = program.opts();
  const positionalTarget = program.args[0] || '';
  const rawTarget = opts.target || positionalTarget;
  const dryRun: boolean = opts.dryRun;
  const skipRefine: boolean = !opts.refine;
  const skipLint: boolean = !opts.lint;
  const discord: boolean = opts.discord;

  console.log(BANNER);

  let targetDir = '';

  if (!rawTarget) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const topLevelFolder = path.basename(process.cwd());
    const answer = await new Promise<string>(resolve => {
      rl.question(`${pc.yellow('[?]')} Heyyyy Welcome! Anyways, do you want to perform the action inside every folder inside [${topLevelFolder}]? (Y/n) `, resolve);
    });
    rl.close();

    const lowerAnswer = answer.trim().toLowerCase();
    if (lowerAnswer === '' || lowerAnswer === 'y' || lowerAnswer === 'yes') {
      targetDir = process.cwd();
    } else {
      program.help();
    }
  } else {
    if (fs.existsSync(path.resolve(process.cwd(), rawTarget))) {
      targetDir = path.resolve(process.cwd(), rawTarget);
    } else {
      const found = findTargetDir(process.cwd(), rawTarget);
      if (found) {
        targetDir = found;
        LOG.info(`found matching folder: ${pc.bold(targetDir)}`);
      } else {
        LOG.error(`could not find any folder named "${rawTarget}"`);
        process.exit(1);
      }
    }
  }

  const backupDir = path.resolve(process.cwd(), 'mts-migrator/backups', new Date().toISOString().replace(/[:.]/g, '-'));
  const reportPath = path.resolve(process.cwd(), 'mts-migrator/migration-report.json');

  LOG.info(`target: ${pc.bold(targetDir)}`);
  LOG.info(`backups: ${pc.bold(backupDir)}`);
  if (dryRun) LOG.info(pc.yellow('dry run mode — no files will be written'));
  if (discord) LOG.info(pc.cyan('discord.js compat transforms enabled'));
  LOG.info('');

  if (!fs.existsSync(targetDir)) {
    LOG.error(`target directory not found: ${targetDir}`);
    process.exit(1);
  }

  if (!dryRun) fs.mkdirSync(backupDir, { recursive: true });

  const jsFiles = findJsFiles(targetDir);

  LOG.info(`found ${pc.bold(String(jsFiles.length))} javascript files to process`);
  LOG.info('');
  LOG.info(pc.magenta('═══════════════════════════════════════════'));
  LOG.info('');

  const results: MigrationResult[] = [];
  const startTime = Date.now();

  for (let i = 0; i < jsFiles.length; i++) {
    const file = jsFiles[i];
    const progress = `[${i + 1}/${jsFiles.length}]`;
    LOG.info(`${pc.dim(progress)} processing ${pc.cyan(path.relative(targetDir, file))}`);
    results.push(migrateFile(file, backupDir, dryRun, discord));
    console.log('');
  }

  // collect migrated file paths for post-processing
  const migratedFiles = results
    .filter(r => r.status === 'migrated' || r.status === 'migrated-reexport')
    .map(r => path.resolve(process.cwd(), r.target));

  // step 6: ts-morph type refinement
  let totalRefined = 0;
  if (!dryRun && !skipRefine && migratedFiles.length > 0) {
    LOG.info('');
    LOG.info(pc.magenta('═══════════════════════════════════════════'));
    LOG.step(`refining types with ts-morph (${migratedFiles.length} files)...`);

    const refined = refineTypes(migratedFiles, targetDir);
    for (const [filePath, count] of refined) {
      const rel = path.relative(targetDir, filePath);
      LOG.success(`refined ${pc.bold(String(count))} types in ${pc.cyan(rel)}`);
      totalRefined += count;

      // update the matching result
      const result = results.find(r => path.resolve(process.cwd(), r.target) === filePath);
      if (result) result.refinedTypes = count;
    }

    if (totalRefined === 0) {
      LOG.detail('no types could be further refined');
    } else {
      LOG.success(`${pc.bold(String(totalRefined))} total types refined`);
    }
  }

  // step 7: eslint --fix
  if (!dryRun && !skipLint && migratedFiles.length > 0) {
    LOG.info('');
    LOG.step('running eslint --fix...');
    const linted = runLintFix(migratedFiles, targetDir);
    if (linted) {
      LOG.success('eslint fixes applied');
    } else {
      LOG.detail('eslint not available in target project, skipping');
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  const migrated = results.filter(r => r.status === 'migrated' || r.status === 'migrated-reexport').length;
  const skipped = results.filter(r => r.status.startsWith('skipped')).length;
  const errors = results.filter(r => r.status.startsWith('error')).length;

  console.log('');
  LOG.info(pc.magenta('═══════════════════════════════════════════'));
  console.log('');
  LOG.info(`${pc.bold('migration complete!')} (${elapsed}s)`);
  LOG.info(`  ${pc.green('✓ migrated:')} ${migrated}`);
  LOG.info(`  ${pc.yellow('⚠ skipped:')}  ${skipped}`);
  LOG.info(`  ${pc.red('✗ errors:')}   ${errors}`);
  if (totalRefined > 0) LOG.info(`  ${pc.blue('⬆ refined:')} ${totalRefined} types`);
  if (!dryRun) LOG.info(`  backups:  ${backupDir}`);

  if (!dryRun) {
    try {
      const reportDir = path.dirname(reportPath);
      fs.mkdirSync(reportDir, { recursive: true });
      const report: MigrationReport = {
        timestamp: new Date().toISOString(),
        targetDir,
        backupDir,
        elapsedSeconds: parseFloat(elapsed),
        summary: { total: jsFiles.length, migrated, skipped, errors, typesRefined: totalRefined },
        files: results,
      };
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      LOG.info(`  report:   ${reportPath}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      LOG.warn(`failed to save report: ${msg}`);
    }
  }

  console.log('');
  if (errors > 0) {
    LOG.warn(`${errors} file(s) had errors. check the report for details.`);
    LOG.warn(`original .js files are untouched — .ts files are new additions.`);
  }
  LOG.info(pc.magenta(pc.bold('mts migration complete ✨')));
  console.log('');
}

run().catch(console.error);
