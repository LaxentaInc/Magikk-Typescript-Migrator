import { Project, SyntaxKind, type SourceFile, type VariableDeclaration, type ParameterDeclaration } from 'ts-morph';
import path from 'path';
import fs from 'fs';

// ts-morph second pass replaces any annotations with types inferred by the typescript compiler
export function refineTypes(filePaths: string[], targetDir: string): Map<string, number> {
  const results = new Map<string, number>();

  // find tsconfig in the target project
  const tsConfigPath = findTsConfig(targetDir);

  let project: Project;
  try {
    project = new Project({
      tsConfigFilePath: tsConfigPath || undefined,
      skipAddingFilesFromTsConfig: true,
      compilerOptions: tsConfigPath ? undefined : {
        target: 99, // esnext
        module: 99,
        strict: false,
        allowJs: true,
        esModuleInterop: true,
        skipLibCheck: true,
      },
    });
  } catch {
    // if ts-morph can't init, just bail the files still have our pass 1 output
    return results;
  }

  // add only the files we migrated
  for (const fp of filePaths) {
    try {
      project.addSourceFileAtPath(fp);
    } catch {
      // skip files that can't be loaded
    }
  }

  for (const sourceFile of project.getSourceFiles()) {
    const refined = refineSourceFile(sourceFile);
    if (refined > 0) {
      results.set(sourceFile.getFilePath(), refined);
    }
  }

  // save all changes
  try {
    project.saveSync();
  } catch {
    // if save fails, original pass 1 output remains
  }

  return results;
}

function refineSourceFile(sourceFile: SourceFile): number {
  let count = 0;

  // refine variable declarations with `: any`
  const varDecls = sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration);
  for (const decl of varDecls) {
    count += tryRefineVariable(decl);
  }

  // refine function/method parameters with `: any`
  const params = sourceFile.getDescendantsOfKind(SyntaxKind.Parameter);
  for (const param of params) {
    count += tryRefineParameter(param);
  }

  return count;
}

function tryRefineVariable(decl: VariableDeclaration): number {
  const typeNode = decl.getTypeNode();
  if (!typeNode) return 0;

  const typeText = typeNode.getText().trim();
  if (typeText !== 'any') return 0;

  // don't refine if there's no initializer nothing to infer from
  if (!decl.getInitializer()) return 0;

  try {
    const inferred = decl.getType().getText(decl);

    // skip if inference didn't improve anything
    if (isUselessType(inferred)) return 0;

    // skip overly complex inferred types (long generics, unions, etc.)
    if (inferred.length > 80) return 0;

    decl.setType(inferred);
    return 1;
  } catch {
    return 0;
  }
}

function tryRefineParameter(param: ParameterDeclaration): number {
  const typeNode = param.getTypeNode();
  if (!typeNode) return 0;

  const typeText = typeNode.getText().trim();
  if (typeText !== 'any') return 0;

  // skip rest params they're fine as any[]
  if (param.isRestParameter()) return 0;

  // skip destructured params too complex to refine cleanly
  const nameNode = param.getNameNode();
  if (nameNode.getKind() === SyntaxKind.ObjectBindingPattern ||
      nameNode.getKind() === SyntaxKind.ArrayBindingPattern) {
    return 0;
  }

  try {
    // check if the param has a default value we can infer from
    const initializer = param.getInitializer();
    if (!initializer) return 0;

    const inferred = param.getType().getText(param);
    if (isUselessType(inferred)) return 0;
    if (inferred.length > 60) return 0;

    param.setType(inferred);
    return 1;
  } catch {
    return 0;
  }
}

// types that aren't worth replacing `any` with
function isUselessType(typeText: string): boolean {
  const useless = new Set([
    'any', 'unknown', 'error', 'never',
    'any[]', 'unknown[]',
    'typeof import("*")',
  ]);

  const cleaned = typeText.trim().toLowerCase();
  if (useless.has(cleaned)) return true;

  // skip if it's a massive union or intersection
  if ((typeText.match(/\|/g) || []).length > 4) return true;
  if ((typeText.match(/&/g) || []).length > 2) return true;

  // skip if it contains import() expressions (too verbose)
  if (typeText.includes('import(')) return true;

  return false;
}

function findTsConfig(dir: string): string | null {
  let current = dir;
  while (true) {
    const candidate = path.join(current, 'tsconfig.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}
