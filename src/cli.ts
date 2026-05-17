#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { codeToAST } from './parser';
import { convertModuleSystem } from './converter';
import { injectTypes } from './transformer';
import { astToCode } from './generator';
import { refineTypes } from './refiner';
import { runLintFix } from './postprocess';
import type { MigrationResult, MigrationReport, CliArgs } from './types';

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
};

const BANNER = `
${C.magenta}${C.bold}
    ╔══════════════════════════════════════════════════════════╗
    ║                                                          ║
    ║    M T S   M I G R A T O R                               ║
    ║                                                          ║
    ║   js → ts transpilation engine                           ║
    ║   by laxenta inc — https://colorwall.xyz                 ║
    ║                                                          ║
    ╚══════════════════════════════════════════════════════════╝
${C.reset}`;

const LOG = {
  info:    (...args: unknown[]) => console.log(`${C.cyan}[INFO]${C.reset}`, ...args),
  success: (...args: unknown[]) => console.log(`${C.green}[✓]${C.reset}`, ...args),
  warn:    (...args: unknown[]) => console.log(`${C.yellow}[⚠]${C.reset}`, ...args),
  error:   (...args: unknown[]) => console.log(`${C.red}[✗]${C.reset}`, ...args),
  step:    (...args: unknown[]) => console.log(`${C.magenta}[→]${C.reset}`, ...args),
  detail:  (...args: unknown[]) => console.log(`${C.dim}   ${C.reset}`, ...args),
};

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next',
  'coverage', '.nyc_output', '__pycache__', '.cache',
  'mts-migrator',
]);

const IGNORE_FILES = new Set([
  'babel.config.js', '.eslintrc.js', 'jest.config.js',
  'webpack.config.js', 'rollup.config.js', 'vite.config.js',
  'tailwind.config.js', 'postcss.config.js', 'next.config.js',
]);

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let target = '';
  let dryRun = false;
  let skipRefine = false;
  let skipLint = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--target' && args[i + 1]) {
      target = args[++i];
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--no-refine') {
      skipRefine = true;
    } else if (args[i] === '--no-lint') {
      skipLint = true;
    } else if (args[i] === '--help' || args[i] === '-h') {
      printHelp();
      process.exit(0);
    } else if (!args[i].startsWith('--')) {
      target = args[i];
    }
  }

  return { target, dryRun, skipRefine, skipLint };
}

function findTargetDir(baseDir: string, targetName: string): string | null {
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !IGNORE_DIRS.has(entry.name)) {
        if (entry.name === targetName) {
          return path.join(baseDir, entry.name);
        }
        const found = findTargetDir(path.join(baseDir, entry.name), targetName);
        if (found) return found;
      }
    }
  } catch (e) {
    //ignore read errors
  }
  return null;
}

function printHelp(): void {
  console.log(`
${C.bold}mts-migrator${C.reset} — js to ts migration engine

${C.bold}usage:${C.reset}
  mts [target] [options]
  pnpm mts [target] [options]
  npx mts-migrator [target] [options]

${C.bold}options:${C.reset}
  --target <dir>   target folder name or path and thats it and it will run on it!
  --dry-run        preview changes without writing files
  --no-refine      skip ts-morph type refinement pass
  --no-lint        skip eslint --fix post-processing
  -h, --help       show this help

${C.bold}examples:${C.reset}
  *if you do not use pnpm, use npm instead of it idk*

  pnpm mts (Just do this command if your are confused; migrates the whole working folder!)

  pnpm mts components (targets the folder named components)

  pnpm mts --target utils --dry-run (preview changes without writing files)

  npx mts-migrator src --no-refine --no-lint (skip eslint --fix post-processing)
`);
}

function walkSync(dir: string, filelist: string[] = []): string[] {
  if (!fs.existsSync(dir)) return filelist;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) walkSync(fullPath, filelist);
    } else if (entry.isFile()) {
      filelist.push(fullPath);
    }
  }

  return filelist;
}

function migrateFile(filePath: string, backupDir: string, dryRun: boolean): MigrationResult {
  const fileName = path.basename(filePath);
  const relativePath = path.relative(process.cwd(), filePath);
  const isJsx = filePath.endsWith('.jsx');
  const tsExt = isJsx ? '.tsx' : '.ts';
  const tsFilePath = filePath.replace(/\.jsx?$/, tsExt);

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
      LOG.warn(`skipping ${C.yellow}${fileName}${C.reset} — ts dupe exists`);
      return result;
    }
    LOG.detail(`existing ${tsExt} is empty, overwriting`);
  }

  // skip config files
  if (IGNORE_FILES.has(fileName)) {
    result.status = 'skipped-config';
    LOG.warn(`skipping config file ${C.yellow}${fileName}${C.reset}`);
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
  LOG.step(`parsing ${C.cyan}${fileName}${C.reset}`);
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
  LOG.step(`converting ${C.cyan}${fileName}${C.reset} module system`);
  try {
    convertModuleSystem(ast);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.warnings.push(`module conversion warning: ${msg}`);
    LOG.warn(`module conversion issue in ${fileName}: ${msg} (continuing)`);
  }

  // step 3: inject types
  LOG.step(`transforming ${C.cyan}${fileName}${C.reset}`);
  try {
    injectTypes(ast);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.status = 'error-transform';
    result.errors.push(`transform error: ${msg}`);
    LOG.error(`transform failed for ${fileName}: ${msg}`);
    return result;
  }

  // step 4: generate output
  LOG.step(`generating ${C.cyan}${path.basename(tsFilePath)}${C.reset}`);
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
    LOG.success(`${C.green}${fileName}${C.reset} → ${C.bold}${path.basename(tsFilePath)}${C.reset} ${C.dim}(dry run)${C.reset}`);
    return result;
  }

  try {
    fs.writeFileSync(tsFilePath, outputCode, 'utf-8');
    result.status = 'migrated';
    LOG.success(`${C.green}${fileName}${C.reset} → ${C.bold}${path.basename(tsFilePath)}${C.reset}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    result.status = 'error-write';
    result.errors.push(`write error: ${msg}`);
    LOG.error(`failed to write ${path.basename(tsFilePath)}: ${msg}`);
  }

  return result;
}

async function run(): Promise<void> {
  console.log(BANNER);

  const { target: rawTarget, dryRun, skipRefine, skipLint } = parseArgs();

  let targetDir = '';

  if (!rawTarget) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const topLevelFolder = path.basename(process.cwd());
    const answer = await new Promise<string>(resolve => {
      rl.question(`${C.yellow}[?]${C.reset} Heyyyy Welcome! Anyways, do you want to perform the action inside every folder inside [${topLevelFolder}]? (Y/n) `, resolve);
    });
    rl.close();

    const lowerAnswer = answer.trim().toLowerCase();
    if (lowerAnswer === '' || lowerAnswer === 'y' || lowerAnswer === 'yes') {
      targetDir = process.cwd();
    } else {
      printHelp();
      process.exit(0);
    }
  } else {
    if (fs.existsSync(path.resolve(process.cwd(), rawTarget))) {
      targetDir = path.resolve(process.cwd(), rawTarget);
    } else {
      const found = findTargetDir(process.cwd(), rawTarget);
      if (found) {
        targetDir = found;
        LOG.info(`found matching folder: ${C.bold}${targetDir}${C.reset}`);
      } else {
        LOG.error(`could not find any folder named "${rawTarget}"`);
        process.exit(1);
      }
    }
  }

  const backupDir = path.resolve(process.cwd(), 'mts-migrator/backups', new Date().toISOString().replace(/[:.]/g, '-'));
  const reportPath = path.resolve(process.cwd(), 'mts-migrator/migration-report.json');

  LOG.info(`target: ${C.bold}${targetDir}${C.reset}`);
  LOG.info(`backups: ${C.bold}${backupDir}${C.reset}`);
  if (dryRun) LOG.info(`${C.yellow}dry run mode — no files will be written${C.reset}`);
  LOG.info('');

  if (!fs.existsSync(targetDir)) {
    LOG.error(`target directory not found: ${targetDir}`);
    process.exit(1);
  }

  if (!dryRun) fs.mkdirSync(backupDir, { recursive: true });

  const allFiles = walkSync(targetDir);
  const jsFiles = allFiles.filter(f => f.endsWith('.js') || f.endsWith('.jsx'));

  LOG.info(`found ${C.bold}${jsFiles.length}${C.reset} javascript files to process`);
  LOG.info('');
  LOG.info(`${C.magenta}═══════════════════════════════════════════${C.reset}`);
  LOG.info('');

  const results: MigrationResult[] = [];
  const startTime = Date.now();

  for (let i = 0; i < jsFiles.length; i++) {
    const file = jsFiles[i];
    const progress = `[${i + 1}/${jsFiles.length}]`;
    LOG.info(`${C.dim}${progress}${C.reset} processing ${C.cyan}${path.relative(targetDir, file)}${C.reset}`);
    results.push(migrateFile(file, backupDir, dryRun));
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
    LOG.info(`${C.magenta}═══════════════════════════════════════════${C.reset}`);
    LOG.step(`refining types with ts-morph (${migratedFiles.length} files)...`);

    const refined = refineTypes(migratedFiles, targetDir);
    for (const [filePath, count] of refined) {
      const rel = path.relative(targetDir, filePath);
      LOG.success(`refined ${C.bold}${count}${C.reset} types in ${C.cyan}${rel}${C.reset}`);
      totalRefined += count;

      // update the matching result
      const result = results.find(r => path.resolve(process.cwd(), r.target) === filePath);
      if (result) result.refinedTypes = count;
    }

    if (totalRefined === 0) {
      LOG.detail('no types could be further refined');
    } else {
      LOG.success(`${C.bold}${totalRefined}${C.reset} total types refined`);
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
  LOG.info(`${C.magenta}═══════════════════════════════════════════${C.reset}`);
  console.log('');
  LOG.info(`${C.bold}migration complete!${C.reset} (${elapsed}s)`);
  LOG.info(`  ${C.green}✓ migrated:${C.reset} ${migrated}`);
  LOG.info(`  ${C.yellow}⚠ skipped:${C.reset}  ${skipped}`);
  LOG.info(`  ${C.red}✗ errors:${C.reset}   ${errors}`);
  if (totalRefined > 0) LOG.info(`  ${C.blue}⬆ refined:${C.reset} ${totalRefined} types`);
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
  LOG.info(`${C.magenta}${C.bold}mts migration complete ✨${C.reset}`);
  console.log('');
}

run().catch(console.error);
