import traverse from '@babel/traverse';
import * as t from '@babel/types';
import type { File } from '@babel/types';

// strip .js/.jsx from relative import paths so typescript resolves them properly
function normalizeImportSource(source: string): string {
  if (source.startsWith('.') && /\.jsx?$/.test(source)) {
    return source.replace(/\.jsx?$/, '');
  }
  return source;
}

export function convertModuleSystem(ast: File): File {
  const importsToAdd: Array<{ node: t.ImportDeclaration; path: any }> = [];
  const pathsToRemove: any[] = [];

  traverse(ast, {
    VariableDeclaration(path) {
      if (!path.parentPath.isProgram()) return;
      const declarations = path.node.declarations;
      if (declarations.length !== 1) return;
      const decl = declarations[0];
      if (!decl.init) return;

      if (
        t.isCallExpression(decl.init) &&
        t.isIdentifier(decl.init.callee, { name: 'require' }) &&
        decl.init.arguments.length === 1 &&
        t.isStringLiteral(decl.init.arguments[0])
      ) {
        const source = normalizeImportSource(decl.init.arguments[0].value);

        if (t.isObjectPattern(decl.id)) {
          const specifiers: t.ImportSpecifier[] = [];
          for (const prop of decl.id.properties) {
            if (t.isRestElement(prop)) continue;
            if (!t.isObjectProperty(prop)) continue;
            const imported = t.isIdentifier(prop.key) ? prop.key : null;
            const local = t.isIdentifier(prop.value) ? prop.value : null;
            if (!imported || !local) continue;
            specifiers.push(t.importSpecifier(t.identifier(local.name), t.identifier(imported.name)));
          }
          if (specifiers.length > 0) {
            importsToAdd.push({ node: t.importDeclaration(specifiers, t.stringLiteral(source)), path });
            pathsToRemove.push(path);
          }
          return;
        }

        if (t.isIdentifier(decl.id)) {
          importsToAdd.push({
            node: t.importDeclaration([t.importDefaultSpecifier(t.identifier(decl.id.name))], t.stringLiteral(source)),
            path,
          });
          pathsToRemove.push(path);
        }
      }
    },

    ExpressionStatement(path) {
      if (!path.parentPath.isProgram()) return;
      const expr = path.node.expression;

      // #1 — side-effect require() calls: require('dotenv').config() or bare require('./setup')
      if (t.isCallExpression(expr)) {
        // bare require('./setup') — no assignment, no chaining
        if (
          t.isIdentifier(expr.callee, { name: 'require' }) &&
          expr.arguments.length === 1 &&
          t.isStringLiteral(expr.arguments[0])
        ) {
          const source = normalizeImportSource(expr.arguments[0].value);
          path.replaceWith(t.importDeclaration([], t.stringLiteral(source)));
          return;
        }

        // require('dotenv').config() — method call on require
        if (
          t.isMemberExpression(expr.callee) &&
          t.isCallExpression(expr.callee.object) &&
          t.isIdentifier(expr.callee.object.callee, { name: 'require' }) &&
          expr.callee.object.arguments.length === 1 &&
          t.isStringLiteral(expr.callee.object.arguments[0])
        ) {
          const source = normalizeImportSource(expr.callee.object.arguments[0].value);
          const methodName = t.isIdentifier(expr.callee.property) ? expr.callee.property.name : null;

          if (methodName === 'config') {
            // require('dotenv').config() -> import 'dotenv/config'
            path.replaceWith(t.importDeclaration([], t.stringLiteral(`${source}/config`)));
          } else {
            // generic: require('x').y() -> import _x from 'x'; _x.y()
            const tempId = `_${source.replace(/[^a-zA-Z0-9]/g, '_')}`;
            path.replaceWithMultiple([
              t.importDeclaration([t.importDefaultSpecifier(t.identifier(tempId))], t.stringLiteral(source)),
              t.expressionStatement(
                t.callExpression(
                  t.memberExpression(t.identifier(tempId), expr.callee.property),
                  expr.arguments
                )
              ),
            ]);
          }
          return;
        }
      }

      if (!t.isAssignmentExpression(expr) || !t.isMemberExpression(expr.left)) return;

      // #2 — exports.X = Y (without module. prefix)
      if (
        t.isIdentifier(expr.left.object, { name: 'exports' }) &&
        t.isIdentifier(expr.left.property)
      ) {
        const propName = expr.left.property.name;
        if (t.isIdentifier(expr.right)) {
          path.replaceWith(t.exportNamedDeclaration(null, [
            t.exportSpecifier(t.identifier(expr.right.name), t.identifier(propName)),
          ]));
        } else {
          path.replaceWith(t.exportNamedDeclaration(
            t.variableDeclaration('const', [t.variableDeclarator(t.identifier(propName), expr.right)]),
            []
          ));
        }
        return;
      }

      // module.exports.X = Y
      if (
        t.isMemberExpression(expr.left.object) &&
        t.isIdentifier(expr.left.object.object, { name: 'module' }) &&
        t.isIdentifier(expr.left.object.property, { name: 'exports' }) &&
        t.isIdentifier(expr.left.property)
      ) {
        const propName = expr.left.property.name;
        if (t.isIdentifier(expr.right)) {
          path.replaceWith(t.exportNamedDeclaration(null, [
            t.exportSpecifier(t.identifier(expr.right.name), t.identifier(propName)),
          ]));
        } else {
          path.replaceWith(t.exportNamedDeclaration(
            t.variableDeclaration('const', [t.variableDeclarator(t.identifier(propName), expr.right)]),
            []
          ));
        }
        return;
      }

      // module.exports = ...
      if (!t.isIdentifier(expr.left.object, { name: 'module' })) return;
      if (!t.isIdentifier(expr.left.property, { name: 'exports' })) return;
      const right = expr.right;

      // re-export: module.exports = require('./x')
      if (
        t.isCallExpression(right) &&
        t.isIdentifier(right.callee, { name: 'require' }) &&
        right.arguments.length === 1 &&
        t.isStringLiteral(right.arguments[0])
      ) {
        const source = normalizeImportSource(right.arguments[0].value);
        path.replaceWithMultiple([
          t.importDeclaration([t.importDefaultSpecifier(t.identifier('_reexport'))], t.stringLiteral(source)),
          t.exportDefaultDeclaration(t.identifier('_reexport')),
        ]);
        return;
      }

      // module.exports = { a, b, c }
      if (t.isObjectExpression(right)) {
        const allProps = right.properties.every(
          (p): p is t.ObjectProperty => t.isObjectProperty(p)
        );

        if (allProps && right.properties.length > 0) {
          const hasComplex = (right.properties as t.ObjectProperty[]).some(
            p => !p.shorthand && !t.isIdentifier(p.value)
          );

          if (!hasComplex) {
            const specifiers = (right.properties as t.ObjectProperty[])
              .map(p => {
                const key = t.isIdentifier(p.key) ? p.key.name : t.isStringLiteral(p.key) ? p.key.value : null;
                const val = t.isIdentifier(p.value) ? p.value.name : null;
                if (!key || !val) return null;
                return t.exportSpecifier(t.identifier(val), t.identifier(key));
              })
              .filter((s): s is t.ExportSpecifier => s !== null);

            if (specifiers.length > 0) {
              path.replaceWithMultiple([
                t.exportNamedDeclaration(null, specifiers),
                t.exportDefaultDeclaration(right),
              ]);
              return;
            }
          }
        }
        path.replaceWith(t.exportDefaultDeclaration(right));
        return;
      }

      path.replaceWith(t.exportDefaultDeclaration(right as t.Expression));
    },
  });

  for (let i = pathsToRemove.length - 1; i >= 0; i--) {
    pathsToRemove[i].remove();
  }

  // #6 — deduplicate imports from the same source before inserting
  if (importsToAdd.length > 0 && ast.program?.body) {
    const merged = deduplicateImports(importsToAdd.map(i => i.node));
    ast.program.body.unshift(...merged);
  }

  return ast;
}

// merge multiple import declarations from the same source into one
function deduplicateImports(imports: t.ImportDeclaration[]): t.ImportDeclaration[] {
  const bySource = new Map<string, t.ImportDeclaration>();

  for (const imp of imports) {
    const source = imp.source.value;
    const existing = bySource.get(source);

    if (!existing) {
      bySource.set(source, t.importDeclaration([...imp.specifiers], t.stringLiteral(source)));
      continue;
    }

    // merge specifiers, avoiding duplicates
    for (const spec of imp.specifiers) {
      const isDupe = existing.specifiers.some(s => {
        if (t.isImportDefaultSpecifier(s) && t.isImportDefaultSpecifier(spec)) return true;
        if (t.isImportSpecifier(s) && t.isImportSpecifier(spec)) {
          return t.isIdentifier(s.local) && t.isIdentifier(spec.local) && s.local.name === spec.local.name;
        }
        return false;
      });

      if (!isDupe) existing.specifiers.push(spec);
    }
  }

  return Array.from(bySource.values());
}
