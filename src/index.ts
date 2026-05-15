// mts-migrator
// import { migrateCode, codeToAST, injectTypes, convertModuleSystem } from 'mts-migrator';

export { codeToAST } from './parser';
export { convertModuleSystem } from './converter';
export { injectTypes } from './transformer';
export { astToCode } from './generator';
export { refineTypes } from './refiner';
export { runLintFix } from './postprocess';
export {
  guessType,
  guessArrayType,
  guessNewExpressionType,
  guessCallExpressionType,
  guessPropertyAccessType,
  extractJSDocTypes,
  jsdocTypeToTSType,
  typesMatch,
} from './analyzer';

export type {
  ParseResult,
  ParseError,
  ParseOptions,
  MigrationResult,
  MigrationStatus,
  MigrationReport,
  JSDocInfo,
  CliArgs,
} from './types';

import { codeToAST } from './parser';
import { convertModuleSystem } from './converter';
import { injectTypes } from './transformer';
import { astToCode } from './generator';

// convenience function, runs the full babel pipeline on a single code string
// does not run ts-morph or eslint (those need file paths)
export function migrateCode(code: string, options: { isReact?: boolean; filePath?: string } = {}): { code: string; errors: string[] } {
  const { ast, errors: parseErrors } = codeToAST(code, options);
  if (!ast) {
    return { code, errors: parseErrors.map(e => e.message) };
  }

  const warnings: string[] = parseErrors.map(e => e.message);

  try {
    convertModuleSystem(ast);
  } catch (err: unknown) {
    warnings.push(`module conversion: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    injectTypes(ast);
  } catch (err: unknown) {
    return { code, errors: [`transform failed: ${err instanceof Error ? err.message : String(err)}`] };
  }

  try {
    const output = astToCode(ast);
    return { code: output, errors: warnings };
  } catch (err: unknown) {
    return { code, errors: [`codegen failed: ${err instanceof Error ? err.message : String(err)}`] };
  }
}
