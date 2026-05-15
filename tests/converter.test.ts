import { describe, it, expect } from 'vitest';
import { codeToAST } from '../src/parser';
import { convertModuleSystem } from '../src/converter';
import { astToCode } from '../src/generator';

// helper/ converts js code through the module converter and returns the output
function convert(code: string): string {
  const { ast } = codeToAST(code);
  if (!ast) throw new Error('parse failed');
  convertModuleSystem(ast);
  return astToCode(ast);
}

describe('convertModuleSystem', () => {
  describe('require → import', () => {
    it('converts default require to default import', () => {
      const output = convert(`const fs = require('fs');`);
      expect(output).toContain('import fs from');
      expect(output).toContain('fs');
      expect(output).not.toContain('require');
    });

    it('converts destructured require to named imports', () => {
      const output = convert(`const { readFile, writeFile } = require('fs');`);
      expect(output).toContain('import');
      expect(output).toContain('readFile');
      expect(output).toContain('writeFile');
      expect(output).not.toContain('require');
    });

    it('converts bare require to side-effect import', () => {
      const output = convert(`require('./setup');`);
      expect(output).toContain('import');
      expect(output).toContain('./setup');
    });

    it('converts require().config() to /config import', () => {
      const output = convert(`require('dotenv').config();`);
      expect(output).toContain('dotenv/config');
    });

    it('strips .js extension from relative imports', () => {
      const output = convert(`const utils = require('./utils.js');`);
      expect(output).toContain('./utils');
      expect(output).not.toContain('.js');
    });

    it('strips .jsx extension from relative imports', () => {
      const output = convert(`const App = require('./App.jsx');`);
      expect(output).toContain('./App');
      expect(output).not.toContain('.jsx');
    });

    it('keeps package names unchanged', () => {
      const output = convert(`const pkg = require('some-package');`);
      expect(output).toContain('some-package');
    });
  });

  describe('module.exports → export', () => {
    it('converts module.exports = expr to export default', () => {
      const output = convert(`
        function handler() {}
        module.exports = handler;
      `);
      expect(output).toContain('export default');
    });

    it('converts module.exports = { a, b } to named exports', () => {
      const output = convert(`
        function a() {}
        function b() {}
        module.exports = { a, b };
      `);
      expect(output).toContain('export');
    });

    it('converts exports.X = Y to named export', () => {
      const output = convert(`
        function myFunc() {}
        exports.myFunc = myFunc;
      `);
      expect(output).toContain('export');
      expect(output).toContain('myFunc');
    });

    it('converts module.exports.X = Y to named export', () => {
      const output = convert(`
        function helper() {}
        module.exports.helper = helper;
      `);
      expect(output).toContain('export');
      expect(output).toContain('helper');
    });

    it('converts module.exports = require() to re-export', () => {
      const output = convert(`module.exports = require('./other');`);
      expect(output).toContain('import');
      expect(output).toContain('export default');
    });
  });

  describe('deduplication', () => {
    it('merges multiple requires from the same source', () => {
      const output = convert(`
        const a = require('lodash');
        const { map } = require('lodash');
      `);
      // should only have one import from lodash
      const importCount = (output.match(/from "lodash"/g) || []).length;
      expect(importCount).toBe(1);
    });
  });
});
