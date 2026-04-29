import traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { File } from '@babel/types';
import { guessType, extractJSDocTypes } from './analyzer';

const MONGOOSE_METHODS = new Set(['Schema', 'model', 'models']);
const CAST_METHODS = new Set(['get', 'findOne', 'find', 'findOneAndUpdate', 'findOneAndDelete']);

export function injectTypes(ast: File): File {
  traverse(ast, {
    VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
      const { id, init } = path.node;

      // mongoose model guard — wrap in `as any` to prevent union callable errors
      if (init && t.isLogicalExpression(init, { operator: '||' })) {
        const right = init.right;
        if (
          t.isCallExpression(right) &&
          t.isMemberExpression(right.callee) &&
          t.isIdentifier(right.callee.property, { name: 'model' }) &&
          !t.isTSAsExpression(init)
        ) {
          path.node.init = t.tsAsExpression(init, t.tsAnyKeyword());
          return;
        }
      }

      if (!t.isIdentifier(id) || id.typeAnnotation || !init) return;
      if (t.isCallExpression(init) && t.isIdentifier(init.callee, { name: 'require' })) return;
      if (isMongooseExpression(init)) return;
      if (t.isNewExpression(init) && isMemberCall(init.callee, 'mongoose', 'Schema')) return;
      if (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)) return;
      if (isChainedCall(init)) return;

      const guessedType = guessType(init);
      if (!guessedType || t.isTSAnyKeyword(guessedType)) return;

      id.typeAnnotation = t.tsTypeAnnotation(guessedType);
    },

    // babel's compound visitor string doesn't have a clean NodePath type,
    // so we use the general Function visitor which covers all function-like nodes
    Function(path: NodePath<t.Function>) {
      const node = path.node;

      const leadingComments = node.leadingComments || path.parent?.leadingComments || [];
      const jsdoc = extractJSDocTypes(leadingComments);

      // also check grandparent comments
      if (path.parentPath?.parentPath) {
        const gpComments = path.parentPath.parentPath.node.leadingComments;
        if (gpComments) {
          const gpJsdoc = extractJSDocTypes(gpComments);
          for (const [name, type] of Object.entries(gpJsdoc.params)) {
            if (!jsdoc.params[name]) jsdoc.params[name] = type;
          }
          if (!jsdoc.returnType && gpJsdoc.returnType) jsdoc.returnType = gpJsdoc.returnType;
        }
      }

      for (const param of node.params) {
        if ((param as t.Identifier).typeAnnotation) continue;

        // rest parameters
        if (t.isRestElement(param)) {
          if (!param.typeAnnotation) {
            const restName = t.isIdentifier(param.argument) ? param.argument.name : null;
            param.typeAnnotation = restName && jsdoc.params[restName]
              ? t.tsTypeAnnotation(jsdoc.params[restName])
              : t.tsTypeAnnotation(t.tsArrayType(t.tsAnyKeyword()));
          }
          continue;
        }

        // default values: function(x = false)
        if (t.isAssignmentPattern(param)) {
          if (!t.isIdentifier(param.left)) continue;
          if (param.left.typeAnnotation) continue;
          const paramName = param.left.name;
          if (jsdoc.params[paramName]) {
            param.left.typeAnnotation = t.tsTypeAnnotation(jsdoc.params[paramName]);
            continue;
          }
          const guessedType = guessType(param.right);
          if (guessedType && !t.isTSAnyKeyword(guessedType)) {
            param.left.typeAnnotation = t.tsTypeAnnotation(guessedType);
          }
          continue;
        }

        // destructured params — skip, too risky
        if (t.isObjectPattern(param) || t.isArrayPattern(param)) continue;

        // simple identifier params
        if (t.isIdentifier(param)) {
          if (jsdoc.params[param.name]) {
            param.typeAnnotation = t.tsTypeAnnotation(jsdoc.params[param.name]);
            continue;
          }
          param.typeAnnotation = t.tsTypeAnnotation(t.tsAnyKeyword());
        }
      }

      // return type from jsdoc
      if (jsdoc.returnType && !node.returnType) {
        node.returnType = node.async
          ? t.tsTypeAnnotation(t.tsTypeReference(t.identifier('Promise'), t.tsTypeParameterInstantiation([jsdoc.returnType])))
          : t.tsTypeAnnotation(jsdoc.returnType);
      }
    },

    // also handle ObjectMethod which isn't covered by Function visitor
    ObjectMethod(path: NodePath<t.ObjectMethod>) {
      const node = path.node;
      for (const param of node.params) {
        if (t.isIdentifier(param) && !param.typeAnnotation) {
          param.typeAnnotation = t.tsTypeAnnotation(t.tsAnyKeyword());
        }
        if (t.isRestElement(param) && !param.typeAnnotation) {
          param.typeAnnotation = t.tsTypeAnnotation(t.tsArrayType(t.tsAnyKeyword()));
        }
      }
    },

    CatchClause(path: NodePath<t.CatchClause>) {
      const param = path.node.param;
      if (!param || param.typeAnnotation) return;
      if (t.isIdentifier(param)) {
        param.typeAnnotation = t.tsTypeAnnotation(t.tsAnyKeyword());
      }
    },

    ClassProperty(path: NodePath<t.ClassProperty>) {
      if (path.node.typeAnnotation || !path.node.value) return;
      const guessedType = guessType(path.node.value);
      if (guessedType && !t.isTSAnyKeyword(guessedType)) {
        path.node.typeAnnotation = t.tsTypeAnnotation(guessedType);
      }
    },

    CallExpression(path: NodePath<t.CallExpression>) {
      // discord.js addFields — cast inline objects to any
      if (
        t.isMemberExpression(path.node.callee) &&
        t.isIdentifier(path.node.callee.property, { name: 'addFields' })
      ) {
        path.node.arguments = path.node.arguments.map(arg =>
          t.isObjectExpression(arg) ? t.tsAsExpression(arg, t.tsAnyKeyword()) : arg
        );
      }

      // cast .get(), .findOne(), etc. to any to prevent strict mode issues
      if (
        t.isMemberExpression(path.node.callee) &&
        t.isIdentifier(path.node.callee.property)
      ) {
        if (CAST_METHODS.has(path.node.callee.property.name)) {
          if (!t.isTSAsExpression(path.parentPath.node)) {
            path.replaceWith(t.tsAsExpression(path.node, t.tsAnyKeyword()));
            path.skip();
          }
        }
      }
    },

    // extract implicit class properties from constructor this.x = ...
    ClassBody(path: NodePath<t.ClassBody>) {
      const body = path.node.body;
      const existingProps = new Set(
        body.filter((n): n is t.ClassProperty => t.isClassProperty(n) && t.isIdentifier(n.key)).map(n => (n.key as t.Identifier).name)
      );

      const ctor = body.find((n): n is t.ClassMethod => t.isClassMethod(n) && t.isIdentifier(n.key, { name: 'constructor' }));
      if (!ctor) return;

      const propsToAdd: t.ClassProperty[] = [];

      traverse(ctor, {
        AssignmentExpression(assignPath: NodePath<t.AssignmentExpression>) {
          const left = assignPath.node.left;
          if (t.isMemberExpression(left) && t.isThisExpression(left.object) && t.isIdentifier(left.property)) {
            const propName = left.property.name;
            if (!existingProps.has(propName)) {
              existingProps.add(propName);
              const guessedType = guessType(assignPath.node.right);
              const annotation = guessedType && !t.isTSAnyKeyword(guessedType)
                ? t.tsTypeAnnotation(guessedType)
                : t.tsTypeAnnotation(t.tsAnyKeyword());
              propsToAdd.push(t.classProperty(t.identifier(propName), null, annotation));
            }
          }
        },
      }, path.scope, path);

      if (propsToAdd.length > 0) {
        path.node.body.unshift(...propsToAdd);
      }
    },
  });

  return ast;
}

function isMongooseExpression(node: t.Node): boolean {
  if (t.isCallExpression(node) && t.isMemberExpression(node.callee)) {
    const obj = node.callee.object;
    const prop = node.callee.property;
    if (t.isIdentifier(obj, { name: 'mongoose' }) && t.isIdentifier(prop) && MONGOOSE_METHODS.has(prop.name)) {
      return true;
    }
  }
  if (t.isLogicalExpression(node)) {
    return isMongooseExpression(node.left) || isMongooseExpression(node.right);
  }
  if (t.isNewExpression(node) && isMemberCall(node.callee, 'mongoose', 'Schema')) {
    return true;
  }
  return false;
}

function isMemberCall(node: t.Node, objName: string, propName: string): boolean {
  return t.isMemberExpression(node) &&
    t.isIdentifier(node.object, { name: objName }) &&
    t.isIdentifier(node.property, { name: propName });
}

function isChainedCall(node: t.Node): boolean {
  if (!t.isCallExpression(node)) return false;
  let depth = 0;
  let current: t.Node = node;
  while (t.isCallExpression(current) && t.isMemberExpression(current.callee)) {
    depth++;
    current = current.callee.object;
  }
  return depth >= 2;
}

