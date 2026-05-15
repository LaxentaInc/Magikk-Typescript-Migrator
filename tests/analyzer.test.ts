import { describe, it, expect } from 'vitest';
import * as t from '@babel/types';
import {
  guessType,
  guessArrayType,
  guessNewExpressionType,
  guessCallExpressionType,
  guessPropertyAccessType,
  extractJSDocTypes,
  jsdocTypeToTSType,
  typesMatch,
} from '../src/analyzer';

describe('guessType', () => {
  it('returns string for string literals', () => {
    const result = guessType(t.stringLiteral('hello'));
    expect(result).not.toBeNull();
    expect(t.isTSStringKeyword(result!)).toBe(true);
  });

  it('returns string for template literals', () => {
    const result = guessType(t.templateLiteral([t.templateElement({ raw: 'hi', cooked: 'hi' })], []));
    expect(t.isTSStringKeyword(result!)).toBe(true);
  });

  it('returns number for numeric literals', () => {
    const result = guessType(t.numericLiteral(42));
    expect(t.isTSNumberKeyword(result!)).toBe(true);
  });

  it('returns boolean for boolean literals', () => {
    const result = guessType(t.booleanLiteral(true));
    expect(t.isTSBooleanKeyword(result!)).toBe(true);
  });

  it('returns null for null literals', () => {
    const result = guessType(t.nullLiteral());
    expect(result).toBeNull();
  });

  it('returns RegExp for regex literals', () => {
    const result = guessType(t.regExpLiteral('abc', 'g'));
    expect(t.isTSTypeReference(result!)).toBe(true);
  });

  it('returns any for null/undefined input', () => {
    const result = guessType(null);
    expect(t.isTSAnyKeyword(result!)).toBe(true);
  });

  it('returns boolean for unary negation', () => {
    const result = guessType(t.unaryExpression('!', t.booleanLiteral(true)));
    expect(t.isTSBooleanKeyword(result!)).toBe(true);
  });

  it('returns Record<string, any> for object expressions', () => {
    const result = guessType(t.objectExpression([]));
    expect(t.isTSTypeReference(result!)).toBe(true);
  });

  it('returns null for arrow functions (let them be inferred)', () => {
    const arrow = t.arrowFunctionExpression([], t.blockStatement([]));
    const result = guessType(arrow);
    expect(result).toBeNull();
  });

  it('infers type from assignment rhs', () => {
    const assignment = t.assignmentExpression('=', t.identifier('x'), t.numericLiteral(5));
    const result = guessType(assignment);
    expect(t.isTSNumberKeyword(result!)).toBe(true);
  });

  it('unwraps await expressions', () => {
    const awaited = t.awaitExpression(t.numericLiteral(10));
    const result = guessType(awaited);
    expect(t.isTSNumberKeyword(result!)).toBe(true);
  });
});

describe('guessArrayType', () => {
  it('returns any[] for empty arrays', () => {
    const result = guessArrayType(t.arrayExpression([]));
    expect(t.isTSArrayType(result!)).toBe(true);
  });

  it('returns number[] for uniform numeric arrays', () => {
    const arr = t.arrayExpression([t.numericLiteral(1), t.numericLiteral(2), t.numericLiteral(3)]);
    const result = guessArrayType(arr);
    expect(t.isTSArrayType(result!)).toBe(true);
    if (t.isTSArrayType(result!)) {
      expect(t.isTSNumberKeyword(result!.elementType)).toBe(true);
    }
  });

  it('returns any[] for mixed-type arrays', () => {
    const arr = t.arrayExpression([t.numericLiteral(1), t.stringLiteral('hello')]);
    const result = guessArrayType(arr);
    expect(t.isTSArrayType(result!)).toBe(true);
    if (t.isTSArrayType(result!)) {
      expect(t.isTSAnyKeyword(result!.elementType)).toBe(true);
    }
  });
});

describe('guessNewExpressionType', () => {
  it('returns Map<any, any> for new Map()', () => {
    const node = t.newExpression(t.identifier('Map'), []);
    const result = guessNewExpressionType(node);
    expect(t.isTSTypeReference(result!)).toBe(true);
  });

  it('returns Set<any> for new Set()', () => {
    const node = t.newExpression(t.identifier('Set'), []);
    const result = guessNewExpressionType(node);
    expect(t.isTSTypeReference(result!)).toBe(true);
  });

  it('returns Date for new Date()', () => {
    const node = t.newExpression(t.identifier('Date'), []);
    const result = guessNewExpressionType(node);
    expect(t.isTSTypeReference(result!)).toBe(true);
  });

  it('returns custom class type for new MyClass()', () => {
    const node = t.newExpression(t.identifier('MyClass'), []);
    const result = guessNewExpressionType(node);
    expect(t.isTSTypeReference(result!)).toBe(true);
    if (t.isTSTypeReference(result!) && t.isIdentifier(result!.typeName)) {
      expect(result!.typeName.name).toBe('MyClass');
    }
  });

  it('returns any for non-identifier callee', () => {
    const node = t.newExpression(t.memberExpression(t.identifier('a'), t.identifier('b')), []);
    const result = guessNewExpressionType(node);
    expect(t.isTSAnyKeyword(result!)).toBe(true);
  });
});

describe('guessCallExpressionType', () => {
  it('returns null for require() calls', () => {
    const node = t.callExpression(t.identifier('require'), [t.stringLiteral('fs')]);
    const result = guessCallExpressionType(node);
    expect(result).toBeNull();
  });

  it('returns number for parseInt()', () => {
    const node = t.callExpression(t.identifier('parseInt'), [t.stringLiteral('42')]);
    const result = guessCallExpressionType(node);
    expect(t.isTSNumberKeyword(result!)).toBe(true);
  });

  it('returns number for Math.floor()', () => {
    const node = t.callExpression(
      t.memberExpression(t.identifier('Math'), t.identifier('floor')),
      [t.numericLiteral(3.14)]
    );
    const result = guessCallExpressionType(node);
    expect(t.isTSNumberKeyword(result!)).toBe(true);
  });

  it('returns string for .toString()', () => {
    const node = t.callExpression(
      t.memberExpression(t.identifier('x'), t.identifier('toString')),
      []
    );
    const result = guessCallExpressionType(node);
    expect(t.isTSStringKeyword(result!)).toBe(true);
  });

  it('returns boolean for .includes()', () => {
    const node = t.callExpression(
      t.memberExpression(t.identifier('arr'), t.identifier('includes')),
      [t.numericLiteral(1)]
    );
    const result = guessCallExpressionType(node);
    expect(t.isTSBooleanKeyword(result!)).toBe(true);
  });

  it('returns number for Date.now()', () => {
    const node = t.callExpression(
      t.memberExpression(t.identifier('Date'), t.identifier('now')),
      []
    );
    const result = guessCallExpressionType(node);
    expect(t.isTSNumberKeyword(result!)).toBe(true);
  });
});

describe('guessPropertyAccessType', () => {
  it('returns string | undefined for process.env.X', () => {
    const node = t.memberExpression(
      t.memberExpression(t.identifier('process'), t.identifier('env')),
      t.identifier('NODE_ENV')
    );
    const result = guessPropertyAccessType(node);
    expect(t.isTSUnionType(result!)).toBe(true);
  });

  it('returns number for .length', () => {
    const node = t.memberExpression(t.identifier('arr'), t.identifier('length'));
    const result = guessPropertyAccessType(node);
    expect(t.isTSNumberKeyword(result!)).toBe(true);
  });

  it('returns number for .size', () => {
    const node = t.memberExpression(t.identifier('map'), t.identifier('size'));
    const result = guessPropertyAccessType(node);
    expect(t.isTSNumberKeyword(result!)).toBe(true);
  });
});

describe('jsdocTypeToTSType', () => {
  it('maps primitive types', () => {
    expect(t.isTSStringKeyword(jsdocTypeToTSType('string'))).toBe(true);
    expect(t.isTSNumberKeyword(jsdocTypeToTSType('number'))).toBe(true);
    expect(t.isTSBooleanKeyword(jsdocTypeToTSType('boolean'))).toBe(true);
    expect(t.isTSVoidKeyword(jsdocTypeToTSType('void'))).toBe(true);
    expect(t.isTSAnyKeyword(jsdocTypeToTSType('any'))).toBe(true);
    expect(t.isTSNeverKeyword(jsdocTypeToTSType('never'))).toBe(true);
  });

  it('handles array notation', () => {
    const result = jsdocTypeToTSType('string[]');
    expect(t.isTSArrayType(result)).toBe(true);
  });

  it('handles union types', () => {
    const result = jsdocTypeToTSType('string|number');
    expect(t.isTSUnionType(result)).toBe(true);
    if (t.isTSUnionType(result)) {
      expect(result.types).toHaveLength(2);
    }
  });

  it('handles import() types', () => {
    const result = jsdocTypeToTSType("import('discord.js').Client");
    expect(t.isTSTypeReference(result)).toBe(true);
  });

  it('handles unknown types as type references', () => {
    const result = jsdocTypeToTSType('MyCustomType');
    expect(t.isTSTypeReference(result)).toBe(true);
    if (t.isTSTypeReference(result) && t.isIdentifier(result.typeName)) {
      expect(result.typeName.name).toBe('MyCustomType');
    }
  });
});

describe('extractJSDocTypes', () => {
  it('extracts @param types', () => {
    const comment: t.CommentBlock = {
      type: 'CommentBlock',
      value: '* @param {string} name the user name\n * @param {number} age the user age',
      start: 0,
      end: 0,
      loc: null as any,
    };

    const result = extractJSDocTypes([comment]);
    expect(t.isTSStringKeyword(result.params['name'])).toBe(true);
    expect(t.isTSNumberKeyword(result.params['age'])).toBe(true);
  });

  it('extracts @returns type', () => {
    const comment: t.CommentBlock = {
      type: 'CommentBlock',
      value: '* @returns {boolean} whether valid',
      start: 0,
      end: 0,
      loc: null as any,
    };

    const result = extractJSDocTypes([comment]);
    expect(result.returnType).not.toBeNull();
    expect(t.isTSBooleanKeyword(result.returnType!)).toBe(true);
  });

  it('returns empty for no comments', () => {
    const result = extractJSDocTypes([]);
    expect(Object.keys(result.params)).toHaveLength(0);
    expect(result.returnType).toBeNull();
  });

  it('ignores line comments', () => {
    const comment: t.CommentLine = {
      type: 'CommentLine',
      value: ' @param {string} name',
      start: 0,
      end: 0,
      loc: null as any,
    };

    const result = extractJSDocTypes([comment]);
    expect(Object.keys(result.params)).toHaveLength(0);
  });
});

describe('typesMatch', () => {
  it('matches identical keywords', () => {
    expect(typesMatch(t.tsStringKeyword(), t.tsStringKeyword())).toBe(true);
    expect(typesMatch(t.tsNumberKeyword(), t.tsNumberKeyword())).toBe(true);
  });

  it('does not match different keywords', () => {
    expect(typesMatch(t.tsStringKeyword(), t.tsNumberKeyword())).toBe(false);
  });

  it('returns false for null inputs', () => {
    expect(typesMatch(null, t.tsStringKeyword())).toBe(false);
    expect(typesMatch(t.tsStringKeyword(), null)).toBe(false);
    expect(typesMatch(null, null)).toBe(false);
  });

  it('matches array types with same element type', () => {
    const a = t.tsArrayType(t.tsStringKeyword());
    const b = t.tsArrayType(t.tsStringKeyword());
    expect(typesMatch(a, b)).toBe(true);
  });

  it('does not match array types with different element types', () => {
    const a = t.tsArrayType(t.tsStringKeyword());
    const b = t.tsArrayType(t.tsNumberKeyword());
    expect(typesMatch(a, b)).toBe(false);
  });

  it('matches type references by name', () => {
    const a = t.tsTypeReference(t.identifier('Date'));
    const b = t.tsTypeReference(t.identifier('Date'));
    expect(typesMatch(a, b)).toBe(true);
  });

  it('does not match type references with different names', () => {
    const a = t.tsTypeReference(t.identifier('Date'));
    const b = t.tsTypeReference(t.identifier('RegExp'));
    expect(typesMatch(a, b)).toBe(false);
  });

  it('matches union types with same members', () => {
    const a = t.tsUnionType([t.tsStringKeyword(), t.tsNumberKeyword()]);
    const b = t.tsUnionType([t.tsStringKeyword(), t.tsNumberKeyword()]);
    expect(typesMatch(a, b)).toBe(true);
  });
});
