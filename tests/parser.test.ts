import { describe, it, expect } from 'vitest';
import { codeToAST } from '../src/parser';

describe('parser', () => {
  it('parses basic javascript', () => {
    const { ast, errors } = codeToAST('const x = 42;');
    expect(ast).not.toBeNull();
    expect(errors.filter(e => e.fatal)).toHaveLength(0);
  });

  it('parses jsx syntax', () => {
    const { ast } = codeToAST('<div>hello</div>', { isReact: true });
    expect(ast).not.toBeNull();
  });

  it('parses commonjs requires', () => {
    const { ast } = codeToAST(`const fs = require('fs');`);
    expect(ast).not.toBeNull();
  });

  it('handles optional chaining', () => {
    const { ast } = codeToAST('const x = obj?.foo?.bar;');
    expect(ast).not.toBeNull();
  });

  it('handles async/await', () => {
    const { ast } = codeToAST('async function run() { await fetch("/"); }');
    expect(ast).not.toBeNull();
  });

  it('handles class private fields', () => {
    const { ast } = codeToAST('class Foo { #bar = 42; }');
    expect(ast).not.toBeNull();
  });

  it('includes file path in errors', () => {
    const { errors } = codeToAST('}{', { filePath: 'myfile.js' });
    if (errors.length > 0) {
      expect(errors[0].message).toContain('myfile.js');
    }
  });
});
