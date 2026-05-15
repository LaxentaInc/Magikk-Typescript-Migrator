## A js → ts code migrator, As It Is.
### Made because i needed it, there might be others, but idk, I used to this convert by 33k ish lines of JS code to typescript, it works <.3

converts javascript files to typescript — handles module system conversion (commonjs → esm), infers types from ast analysis, extracts jsdoc annotations, refines types with the typescript compiler, and optionally runs eslint --fix.

> js → ts migrator by [laxenta inc](https://colorwall.xyz)

## install

```bash
# global (recommended for cli usage)
pnpm add -g mts-migrator

# or local
pnpm add -D mts-migrator
```

## cli usage

```bash
# migrate a directory (defaults to ./src)
mts ./src

# preview changes without writing
mts ./src --dry-run

# skip ts-morph type refinement
mts ./src --no-refine

# skip eslint --fix post-processing  
mts ./src --no-lint

# show help
mts --help
```

## what it does

### pipeline

```
.js file → parse (babel) → convert modules → inject types → generate .ts
         → refine types (ts-morph) → eslint --fix → done
```

### module conversion
- `const fs = require('fs')` → `import fs from 'fs'`
- `const { x } = require('y')` → `import { x } from 'y'`
- `require('dotenv').config()` → `import 'dotenv/config'`
- `module.exports = { x, y }` → `export { x, y }`
- `exports.x = y` → `export { y as x }`
- strips `.js`/`.jsx` from relative imports
- deduplicates imports from the same source

### type inference
- literals: `"hello"` → `string`, `42` → `number`, `true` → `boolean`
- constructors: `new Map()` → `Map<any, any>`, `new Date()` → `Date`
- known apis: `Math.floor()` → `number`, `process.env.X` → `string | undefined`
- arrays: `[1, 2, 3]` → `number[]`
- binary ops: `a + b` → `number` or `any`, `a === b` → `boolean`
- jsdoc: `@param {string} name` → `name: string`

### type refinement (ts-morph)
after the initial babel pass, ts-morph uses the typescript compiler to replace `any` annotations with actually-inferred types where possible.

### eslint integration
if eslint is installed in your project, `mts` will run `eslint --fix` on the migrated files automatically. if not, it skips silently.

## programmatic api

```typescript
import { migrateCode, codeToAST, injectTypes, convertModuleSystem } from 'mts-migrator';

// quick: convert a code string
const { code, errors } = migrateCode('const x = require("fs");');

// granular: use individual steps
const { ast } = codeToAST(jsCode);
convertModuleSystem(ast);
injectTypes(ast);
const tsCode = astToCode(ast);
```

## features

- **backups**: original files are backed up before migration
- **dry run**: preview what would change without writing
- **error recovery**: non-fatal parse errors don't block migration
- **migration report**: json report with per-file status
- **config skip**: automatically skips config files (webpack, babel, eslint, etc.)

## what it doesn't do

- fix logic bugs in your code
- handle flow types (use flow-to-ts for that)
- replace manually-written type annotations
- guarantee zero `any` in output (but it tries hard)

## license

[AGPL-3.0](./LICENSE)

---

made with <3 by [laxenta inc](https://colorwall.xyz)
