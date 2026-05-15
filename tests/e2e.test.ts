import { describe, it, expect } from 'vitest';
import { migrateCode } from '../src/index';

describe('e2e migration', () => {
  it('converts a complete commonjs file to typescript', () => {
    const input = `
const fs = require('fs');
const { join } = require('path');

const MAX_SIZE = 1024;
const name = "test";

/**
 * @param {string} filePath the path
 * @returns {boolean} whether it exists
 */
function checkFile(filePath) {
  return fs.existsSync(filePath);
}

module.exports = { checkFile, MAX_SIZE };
    `.trim();

    const { code, errors } = migrateCode(input);

    // should have esm imports
    expect(code).toContain("import");
    expect(code).toContain('from "fs"');
    expect(code).toContain('from "path"');

    // should have type annotations
    expect(code).toContain('number');
    expect(code).toContain('string');

    // should have exports
    expect(code).toContain('export');

    // should not have require
    expect(code).not.toContain('require(');
  });

  it('handles jsx files', () => {
    const input = `
const React = require('react');
function App(props) {
  return <div>{props.name}</div>;
}
module.exports = App;
    `.trim();

    const { code } = migrateCode(input, { isReact: true });
    expect(code).toContain('import');
    expect(code).toContain('export default');
  });

  it('preserves comments', () => {
    const input = `
// this is a comment
const x = 42;
/* block comment */
function foo() {}
    `.trim();

    const { code } = migrateCode(input);
    expect(code).toContain('this is a comment');
    expect(code).toContain('block comment');
  });

  it('handles empty input gracefully', () => {
    const { code, errors } = migrateCode('');
    expect(errors.filter(e => !e.includes('warning'))).toHaveLength(0);
  });

  it('handles class with constructor assignments', () => {
    const input = `
class User {
  constructor(name, age) {
    this.name = name;
    this.age = age;
    this.active = true;
  }
}
    `.trim();

    const { code } = migrateCode(input);
    expect(code).toContain('class User');
    expect(code).toContain('boolean');
  });
});
