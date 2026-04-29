import * as t from '@babel/types';
import type { Expression, Node, TSType, Comment } from '@babel/types';
import type { JSDocInfo } from './types';

// core type inference from an ast node
export function guessType(node: Expression | null | undefined): TSType | null {
  if (!node) return t.tsAnyKeyword();

  // literals
  if (t.isStringLiteral(node) || t.isTemplateLiteral(node)) return t.tsStringKeyword();
  if (t.isNumericLiteral(node)) return t.tsNumberKeyword();
  if (t.isBooleanLiteral(node)) return t.tsBooleanKeyword();
  if (t.isNullLiteral(node)) return null;
  if (t.isRegExpLiteral(node)) return t.tsTypeReference(t.identifier('RegExp'));

  // arrays
  if (t.isArrayExpression(node)) return guessArrayType(node);

  // object literals -> Record<string, any>
  if (t.isObjectExpression(node)) {
    return t.tsTypeReference(
      t.identifier('Record'),
      t.tsTypeParameterInstantiation([t.tsStringKeyword(), t.tsAnyKeyword()])
    );
  }

  // new expressions
  if (t.isNewExpression(node)) return guessNewExpressionType(node);

  // call expressions
  if (t.isCallExpression(node)) return guessCallExpressionType(node);

  // function expressions — skip, let them be inferred naturally
  if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) return null;

  // unary negation
  if (t.isUnaryExpression(node) && node.operator === '!') return t.tsBooleanKeyword();

  // binary expressions
  if (t.isBinaryExpression(node)) return guessBinaryType(node);

  // logical expressions (||, ??)
  if (t.isLogicalExpression(node)) {
    const rightType = guessType(node.right);
    if (rightType && !t.isTSAnyKeyword(rightType)) return rightType;
    const leftType = guessType(node.left);
    if (leftType && !t.isTSAnyKeyword(leftType)) return leftType;
  }

  // ternary
  if (t.isConditionalExpression(node)) {
    const consType = guessType(node.consequent);
    const altType = guessType(node.alternate);
    if (consType && altType && typesMatch(consType, altType)) return consType;
    return t.tsAnyKeyword();
  }

  // await — unwrap and infer inner
  if (t.isAwaitExpression(node)) return guessType(node.argument);

  // member access
  if (t.isMemberExpression(node)) return guessPropertyAccessType(node);

  // assignment — infer from rhs
  if (t.isAssignmentExpression(node)) return guessType(node.right);

  return t.tsAnyKeyword();
}

const MATH_OPS = new Set(['+', '-', '*', '/', '%', '**', '|', '&', '^', '<<', '>>', '>>>']);
const BOOL_OPS = new Set(['===', '!==', '==', '!=', '<', '>', '<=', '>=', 'instanceof', 'in']);

function guessBinaryType(node: t.BinaryExpression): TSType {
  if (BOOL_OPS.has(node.operator)) return t.tsBooleanKeyword();

  if (node.operator === '+') {
    const left = t.isPrivateName(node.left) ? null : node.left;
    const right = t.isPrivateName(node.right) ? null : node.right;
    const leftType = guessType(left);
    const rightType = guessType(right);
    if (leftType && rightType && t.isTSNumberKeyword(leftType) && t.isTSNumberKeyword(rightType)) {
      return t.tsNumberKeyword();
    }
    return t.tsAnyKeyword();
  }

  if (MATH_OPS.has(node.operator)) return t.tsNumberKeyword();
  return t.tsAnyKeyword();
}

export function guessArrayType(node: t.ArrayExpression): TSType {
  if (!node.elements || node.elements.length === 0) {
    return t.tsArrayType(t.tsAnyKeyword());
  }

  const types = node.elements
    .filter((el): el is Expression => el !== null && !t.isSpreadElement(el))
    .slice(0, 5)
    .map(el => guessType(el))
    .filter((ty): ty is TSType => ty !== null);

  if (types.length === 0) return t.tsArrayType(t.tsAnyKeyword());

  const firstType = types[0];
  const allSame = types.every(ty => typesMatch(ty, firstType));
  return t.tsArrayType(allSame ? firstType : t.tsAnyKeyword());
}

export function guessNewExpressionType(node: t.NewExpression): TSType {
  if (!t.isIdentifier(node.callee)) return t.tsAnyKeyword();

  const name = node.callee.name;

  const genericMap: Record<string, () => TSType> = {
    'Map':        () => t.tsTypeReference(t.identifier('Map'), t.tsTypeParameterInstantiation([t.tsAnyKeyword(), t.tsAnyKeyword()])),
    'Set':        () => t.tsTypeReference(t.identifier('Set'), t.tsTypeParameterInstantiation([t.tsAnyKeyword()])),
    'WeakMap':    () => t.tsTypeReference(t.identifier('WeakMap'), t.tsTypeParameterInstantiation([t.tsAnyKeyword(), t.tsAnyKeyword()])),
    'WeakSet':    () => t.tsTypeReference(t.identifier('WeakSet'), t.tsTypeParameterInstantiation([t.tsAnyKeyword()])),
    'Array':      () => t.tsArrayType(t.tsAnyKeyword()),
    'Date':       () => t.tsTypeReference(t.identifier('Date')),
    'RegExp':     () => t.tsTypeReference(t.identifier('RegExp')),
    'Error':      () => t.tsTypeReference(t.identifier('Error')),
    'Promise':    () => t.tsTypeReference(t.identifier('Promise'), t.tsTypeParameterInstantiation([t.tsAnyKeyword()])),
    'Collection': () => t.tsTypeReference(t.identifier('Collection'), t.tsTypeParameterInstantiation([t.tsAnyKeyword(), t.tsAnyKeyword()])),
  };

  if (genericMap[name]) return genericMap[name]();
  return t.tsTypeReference(t.identifier(name));
}

export function guessCallExpressionType(node: t.CallExpression): TSType | null {
  // require() skip, module system handles it
  if (t.isIdentifier(node.callee) && node.callee.name === 'require') return null;

  if (t.isMemberExpression(node.callee)) {
    const obj = node.callee.object;
    const prop = node.callee.property;

    // Date.now() -> number
    if (t.isIdentifier(obj, { name: 'Date' }) && t.isIdentifier(prop, { name: 'now' })) {
      return t.tsNumberKeyword();
    }

    // Math.* -> number
    if (t.isIdentifier(obj, { name: 'Math' })) return t.tsNumberKeyword();

    // Array.from() -> any[]
    if (t.isIdentifier(obj, { name: 'Array' }) && t.isIdentifier(prop, { name: 'from' })) {
      return t.tsArrayType(t.tsAnyKeyword());
    }

    if (t.isIdentifier(prop)) {
      // .toString() -> string
      if (prop.name === 'toString') return t.tsStringKeyword();
      // .join() -> string
      if (prop.name === 'join') return t.tsStringKeyword();

      // array-like methods that return collections/arrays — use any to stay safe with discord.js
      const arrayReturnMethods = new Set(['filter', 'map', 'slice', 'concat', 'flat', 'flatMap', 'sort', 'reverse']);
      if (arrayReturnMethods.has(prop.name)) return t.tsAnyKeyword();

      // boolean methods
      const boolMethods = new Set(['includes', 'some', 'every', 'has']);
      if (boolMethods.has(prop.name)) return t.tsBooleanKeyword();

      // number methods
      const numMethods = new Set(['indexOf', 'findIndex', 'push', 'unshift']);
      if (numMethods.has(prop.name)) return t.tsNumberKeyword();

      if (prop.name === 'find') return t.tsAnyKeyword();
    }
  }

  // parseInt / parseFloat -> number
  if (t.isIdentifier(node.callee) && (node.callee.name === 'parseInt' || node.callee.name === 'parseFloat')) {
    return t.tsNumberKeyword();
  }

  return t.tsAnyKeyword();
}

export function guessPropertyAccessType(node: t.MemberExpression): TSType {
  // process.env.X -> string | undefined
  if (
    t.isMemberExpression(node.object) &&
    t.isIdentifier(node.object.object, { name: 'process' }) &&
    t.isIdentifier(node.object.property, { name: 'env' })
  ) {
    return t.tsUnionType([t.tsStringKeyword(), t.tsUndefinedKeyword()]);
  }

  // .length / .size -> number
  if (t.isIdentifier(node.property, { name: 'length' }) || t.isIdentifier(node.property, { name: 'size' })) {
    return t.tsNumberKeyword();
  }

  // .id on discord objects is always a snowflake string
  if (t.isIdentifier(node.property, { name: 'id' })) return t.tsStringKeyword();

  return t.tsAnyKeyword();
}

// jsdoc type extraction — reads @param {Type} name and @returns {Type}
export function extractJSDocTypes(comments: readonly Comment[]): JSDocInfo {
  const result: JSDocInfo = { params: {}, returnType: null };
  if (!comments || !Array.isArray(comments)) return result;

  for (const comment of comments) {
    if (comment.type !== 'CommentBlock') continue;
    const text = comment.value;

    const paramMatches = text.matchAll(/@param\s+\{([^}]+)\}\s+(\w+)/g);
    for (const match of paramMatches) {
      result.params[match[2]] = jsdocTypeToTSType(match[1]);
    }

    const returnMatch = text.match(/@returns?\s+\{([^}]+)\}/);
    if (returnMatch) {
      result.returnType = jsdocTypeToTSType(returnMatch[1]);
    }
  }

  return result;
}

// maps a jsdoc type string to a babel ts type node
export function jsdocTypeToTSType(jsdocType: string): TSType {
  const cleaned = jsdocType.trim();

  // handle import() types like `import('discord.js').Client`
  const importMatch = cleaned.match(/^import\(['"]([^'"]+)['"]\)\.(\w+)$/);
  if (importMatch) return t.tsTypeReference(t.identifier(importMatch[2]));

  const typeMap: Record<string, () => TSType> = {
    'string':    () => t.tsStringKeyword(),
    'number':    () => t.tsNumberKeyword(),
    'boolean':   () => t.tsBooleanKeyword(),
    'void':      () => t.tsVoidKeyword(),
    'null':      () => t.tsNullKeyword(),
    'undefined': () => t.tsUndefinedKeyword(),
    'any':       () => t.tsAnyKeyword(),
    'never':     () => t.tsNeverKeyword(),
    'object':    () => t.tsObjectKeyword(),
    'Object':    () => t.tsObjectKeyword(),
    'Function':  () => t.tsTypeReference(t.identifier('Function')),
    'Array':     () => t.tsArrayType(t.tsAnyKeyword()),
    'Promise':   () => t.tsTypeReference(t.identifier('Promise'), t.tsTypeParameterInstantiation([t.tsAnyKeyword()])),
  };

  if (typeMap[cleaned]) return typeMap[cleaned]();

  // array notation: `string[]`
  if (cleaned.endsWith('[]')) {
    return t.tsArrayType(jsdocTypeToTSType(cleaned.slice(0, -2)));
  }

  // union types: `string|number`
  if (cleaned.includes('|')) {
    return t.tsUnionType(cleaned.split('|').map(p => jsdocTypeToTSType(p.trim())));
  }

  return t.tsTypeReference(t.identifier(cleaned));
}

// structural equality check for ts type nodes
export function typesMatch(a: TSType | null, b: TSType | null): boolean {
  if (!a || !b) return false;
  if (a.type !== b.type) return false;

  if (a.type.startsWith('TS') && a.type.endsWith('Keyword')) return true;

  if (t.isTSTypeReference(a) && t.isTSTypeReference(b)) {
    if (t.isIdentifier(a.typeName) && t.isIdentifier(b.typeName)) {
      return a.typeName.name === b.typeName.name;
    }
  }

  if (t.isTSArrayType(a) && t.isTSArrayType(b)) {
    return typesMatch(a.elementType, b.elementType);
  }

  return false;
}
