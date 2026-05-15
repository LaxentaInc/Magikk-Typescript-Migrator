import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';

// fire-and-forget eslint --fix on migrated files
// if eslint is installed in the target project, run it. if not, skip silently.
export function runLintFix(filePaths: string[], targetDir: string): boolean {
  if (filePaths.length === 0) return false;

  // check if eslint is available in the target project
  const eslintBin = findEslint(targetDir);
  if (!eslintBin) return false;

  try {
    // batch files to avoid arg length limits
    const batchSize = 50;
    for (let i = 0; i < filePaths.length; i += batchSize) {
      const batch = filePaths.slice(i, i + batchSize);
      const files = batch.map(f => `"${f}"`).join(' ');
      execSync(`${eslintBin} --fix --no-error-on-unmatched-pattern ${files}`, {
        cwd: targetDir,
        stdio: 'ignore',
        timeout: 60000,
      });
    }
    return true;
  } catch {
    // don't care if eslint fails — the files are still valid
    return false;
  }
}

function findEslint(dir: string): string | null {
  // check for local eslint binary
  const localBin = path.join(dir, 'node_modules', '.bin', 'eslint');
  const localBinCmd = localBin + '.cmd';

  if (fs.existsSync(localBinCmd)) return `"${localBinCmd}"`;
  if (fs.existsSync(localBin)) return `"${localBin}"`;

  // check if npx eslint would work (eslint installed globally)
  try {
    execSync('npx --no eslint --version', { cwd: dir, stdio: 'ignore', timeout: 5000 });
    return 'npx --no eslint';
  } catch {
    return null;
  }
}
