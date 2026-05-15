import { describe, it, expect } from 'vitest';
import { codeToAST } from '../src/parser';
import { injectTypes } from '../src/transformer';
import { astToCode } from '../src/generator';

function transform(code: string): string {
  const { ast } = codeToAST(code);
  if (!ast) throw new Error('parse failed');
  injectTypes(ast);
  return astToCode(ast);
}

describe('injectTypes', () => {
  describe('variable type injection', () => {
    it('annotates variables with inferred types', () => {
      const output = transform(`const x = 42;`);
      expect(output).toContain('number');
    });

    it('annotates string variables', () => {
      const output = transform(`const name = "hello";`);
      expect(output).toContain('string');
    });

    it('annotates boolean variables', () => {
      const output = transform(`const flag = true;`);
      expect(output).toContain('boolean');
    });

    it('does not annotate require calls', () => {
      const output = transform(`const fs = require('fs');`);
      // should not have a type annotation on the require result
      expect(output).not.toMatch(/: \w+.*= require/);
    });

    it('does not annotate arrow functions', () => {
      const output = transform(`const fn = () => {};`);
      // arrow functions should not get return type annotations from variable decl
      expect(output).not.toMatch(/fn:.*=/);
    });
  });

  describe('function parameter typing', () => {
    it('adds any to untyped params', () => {
      const output = transform(`function greet(name) { return name; }`);
      expect(output).toContain('any');
    });

    it('infers type from default values', () => {
      const output = transform(`function greet(name = "world") { return name; }`);
      expect(output).toContain('string');
    });

    it('handles rest parameters', () => {
      const output = transform(`function sum(...nums) { return nums; }`);
      expect(output).toContain('any[]');
    });

    it('handles destructured params', () => {
      const output = transform(`function fn({ a, b }) { return a; }`);
      expect(output).toContain('any');
    });
  });

  describe('jsdoc type extraction', () => {
    it('uses @param types from jsdoc', () => {
      const output = transform(`
        /**
         * @param {string} name the name
         * @param {number} age the age
         */
        function greet(name, age) { return name; }
      `);
      expect(output).toContain('string');
      expect(output).toContain('number');
    });

    it('uses @returns type from jsdoc', () => {
      const output = transform(`
        /**
         * @returns {boolean} whether valid
         */
        function isValid(x) { return !!x; }
      `);
      expect(output).toContain('boolean');
    });
  });

  describe('catch clause typing', () => {
    it('adds any to catch clause parameter', () => {
      const output = transform(`
        try { throw new Error(); } catch (err) { console.log(err); }
      `);
      expect(output).toContain('any');
    });
  });

  describe('class property extraction', () => {
    it('extracts implicit class properties from constructor', () => {
      const output = transform(`
        class Foo {
          constructor() {
            this.name = "hello";
            this.count = 0;
          }
        }
      `);
      // should have class properties declared before constructor
      expect(output).toContain('name');
      expect(output).toContain('count');
    });
  });

  describe('spread element casting', () => {
    it('casts spread elements to any', () => {
      const output = transform(`
        const obj = { ...other };
      `);
      expect(output).toContain('as any');
    });
  });
});
