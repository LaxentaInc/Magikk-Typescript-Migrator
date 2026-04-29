import { parse, type ParserPlugin } from '@babel/parser';
import type { ParseResult, ParseOptions } from './types';

const PLUGINS: ParserPlugin[] = [
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

export function codeToAST(code: string, options: ParseOptions = {}): ParseResult {
  const { filePath: _filePath = 'unknown' } = options;

  try {
    const ast = parse(code, {
      sourceType: 'module',
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      allowSuperOutsideMethod: true,
      errorRecovery: true,
      plugins: PLUGINS,
    });

    const errors = (ast.errors || []).map(e => ({
      message: e.message,
      line: e.loc?.line,
      column: e.loc?.column,
    }));

    return { ast, errors };
  } catch (err: any) {
    return {
      ast: null,
      errors: [{ message: err.message, line: err.loc?.line, column: err.loc?.column, fatal: true }],
    };
  }
}
