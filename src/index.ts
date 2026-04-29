import fs from 'fs';
import path from 'path';
import { codeToAST } from './parser';
import { convertModuleSystem } from './converter';
import { injectTypes } from './transformer';
import { astToCode } from './generator';
import type { MigrationResult, MigrationReport } from './types';

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
    ║    M A G I K K   M I G R A T O R  <.3                     ║
    ║                                                          ║
    ║   js → ts transpilation engine                           ║
    ║   powered by babel ast manipulation                      ║
    ║                                                          ║
    ╚══════════════════════════════════════════════════════════╝
${C.reset}`;

const LOG = {
  info:    (...args: any[]) => console.log(`${C.cyan}[INFO]${C.reset}`, ...args),
  success: (...args: any[]) => console.log(`${C.green}[✓]${C.reset}`, ...args),
  warn:    (...args: any[]) => console.log(`${C.yellow}[⚠]${C.reset}`, ...args),
  error:   (...args: any[]) => console.log(`${C.red}[✗]${C.reset}`, ...args),
  step:    (...args: any[]) => console.log(`${C.magenta}[→]${C.reset}`, ...args),
  detail:  (...args: any[]) => console.log(`${C.dim}   ${C.reset}`, ...args),
};

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next',
  'coverage', '.nyc_output', '__pycache__', '.cache',
  'magikk-migrator',
]);

const IGNORE_FILES = new Set([
  'babel.config.js', '.eslintrc.js', 'jest.config.js',
  'webpack.config.js', 'rollup.config.js', 'vite.config.js',
  'tailwind.config.js', 'postcss.config.js', 'next.config.js',
]);

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

function migrateFile(filePath: string, backupDir: string): MigrationResult {
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
    stats: { typesInjected: 0 },
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
  } catch (err: any) {
    result.status = 'error-read';
    result.errors.push(`failed to read: ${err.message}`);
    LOG.error(`can't read ${fileName}: ${err.message}`);
    return result;
  }

  // backup the original
  try {
    const backupPath = path.join(backupDir, relativePath);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.copyFileSync(filePath, backupPath);
  } catch (err: any) {
    result.warnings.push(`backup failed: ${err.message}`);
    LOG.warn(`backup failed for ${fileName}: ${err.message}`);
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
  } catch (err: any) {
    result.warnings.push(`module conversion warning: ${err.message}`);
    LOG.warn(`module conversion issue in ${fileName}: ${err.message} (continuing)`);
  }

  // step 3: inject types
  LOG.step(`transforming ${C.cyan}${fileName}${C.reset}`);
  try {
    injectTypes(ast);
  } catch (err: any) {
    result.status = 'error-transform';
    result.errors.push(`transform error: ${err.message}`);
    LOG.error(`transform failed for ${fileName}: ${err.message}`);
    return result;
  }

  // step 4: generate output
  LOG.step(`generating ${C.cyan}${path.basename(tsFilePath)}${C.reset}`);
  let outputCode: string;
  try {
    outputCode = astToCode(ast);
  } catch (err: any) {
    result.status = 'error-generate';
    result.errors.push(`generator error: ${err.message}`);
    LOG.error(`code generation failed for ${fileName}: ${err.message}`);
    return result;
  }

  // step 5: write the ts file
  try {
    fs.writeFileSync(tsFilePath, outputCode, 'utf-8');
    result.status = 'migrated';
    LOG.success(`${C.green}${fileName}${C.reset} → ${C.bold}${path.basename(tsFilePath)}${C.reset}`);
  } catch (err: any) {
    result.status = 'error-write';
    result.errors.push(`write error: ${err.message}`);
    LOG.error(`failed to write ${path.basename(tsFilePath)}: ${err.message}`);
  }

  return result;
}

function run(): void {
  console.log(BANNER);

  // resolve project root — works from both dist/ (compiled) and src/ (ts-node)
  const projectRoot = path.resolve(__dirname, __dirname.includes('dist') ? '../..' : '..');
  const targetDir = path.resolve(projectRoot, 'src');
  const backupDir = path.resolve(projectRoot, 'magikk-migrator/backups', new Date().toISOString().replace(/[:.]/g, '-'));
  const reportPath = path.resolve(projectRoot, 'magikk-migrator/migration-report.json');

  LOG.info(`target: ${C.bold}${targetDir}${C.reset}`);
  LOG.info(`backups: ${C.bold}${backupDir}${C.reset}`);
  LOG.info('');

  if (!fs.existsSync(targetDir)) {
    LOG.error(`target directory not found: ${targetDir}`);
    process.exit(1);
  }

  fs.mkdirSync(backupDir, { recursive: true });

  const allFiles = walkSync(targetDir);
  const jsFiles = allFiles.filter(f => f.endsWith('.js') || f.endsWith('.jsx'));

  LOG.info(`found ${C.bold}${allFiles.length}${C.reset} total files`);
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
    results.push(migrateFile(file, backupDir));
    console.log('');
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
  LOG.info(`  backups:  ${backupDir}`);

  try {
    const report: MigrationReport = {
      timestamp: new Date().toISOString(),
      targetDir,
      backupDir,
      elapsedSeconds: parseFloat(elapsed),
      summary: { total: jsFiles.length, migrated, skipped, errors },
      files: results,
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    LOG.info(`  report:   ${reportPath}`);
  } catch (err: any) {
    LOG.warn(`failed to save report: ${err.message}`);
  }

  console.log('');
  if (errors > 0) {
    LOG.warn(`${errors} file(s) had errors. check the report for details.`);
    LOG.warn(`original .js files are untouched — .ts files are new additions.`);
  }
  LOG.info(`${C.magenta}${C.bold}magikk complete ✨${C.reset}`);
  console.log('');
}

run();
