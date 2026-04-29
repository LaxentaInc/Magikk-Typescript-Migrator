import { parse, type ParserPlugin } from '@babel/parser';
import type { ParseResult, ParseOptions } from './types';

const BASE_PLUGINS: ParserPlugin[] = [
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
  const { isReact = false, filePath = 'unknown' } = options;

  // jsx is always included since even non-react files might use jsx-like syntax,
  // but we can add typescript plugin for non-jsx files to get better parsing
  const plugins: ParserPlugin[] = [...BASE_PLUGINS, 'jsx'];
  if (!isReact) {
    plugins.push('typescript');
  }

  try {
    const ast = parse(code, {
      sourceType: 'module',
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      allowSuperOutsideMethod: true,
      errorRecovery: true,
      plugins,
    });

    const errors = (ast.errors || []).map(e => ({
      message: `${filePath}: ${e.message}`,
      line: e.loc?.line,
      column: e.loc?.column,
    }));

    return { ast, errors };
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    const loc = (err as Record<string, any>)?.loc;
    return {
      ast: null,
      errors: [{ message: `${filePath}: ${error.message}`, line: loc?.line, column: loc?.column, fatal: true }],
    };
  }
}
