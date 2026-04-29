import generate from '@babel/generator';
import type { File } from '@babel/types';

export function astToCode(ast: File): string {
  const output = generate(ast, {
    retainLines: false,
    comments: true,
    compact: false,
    concise: false,
    jsescOption: { minimal: true },
  });
  return output.code;
}
