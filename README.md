## A js → ts code migrator, 
### In the world of misunderstanding, To be As accurate as possible

converts javascript files to typescript — handles module system conversion (commonjs → esm), infers types from ast analysis, extracts jsdoc annotations, refines types with the typescript compiler, and optionally runs eslint --fix.

js → ts migrator by [Laxenta INC.](https://colorwall.xyz)

### I also have devloped A Wallpaper Engine in Rust/Tauri! [Colorwall](https://colorwall.xyz)

## Install
you can use it directly via `pnpm dlx` or `npx` without installing:
```bash
pnpm dlx mts-migrator
# or
npx mts-migrator
```

OR install globally (recommended for frequent cli usage):
```bash
pnpm add -g mts-migrator
# or
npm i -g mts-migrator
```

## ----------------------------------- Cli usage, All commands are listed --------------------------------
when you run `mts` (or `pnpm mts` / `npx mts-migrator`) without a target, it will prompt you if you want to run it on all folders in your current directory. if you specify a folder name, it will recursively search for a folder with that name so you don't have to specify the exact path!

```bash
> IF YOU WANT TO USE TO MIGRATE YOUR FOLDER, JUST COPY THIS COMMAND:

# run interactively (will prompt for confirmation)
pnpm mts
```
```bash
# Or Migrate (to typescript) a specific folder by name (recursively searches for "components named folder")
pnpm mts components
```
```bash
# HELP COMMAND!
pnpm mts --help
```

```bash
# use --target explicitly
pnpm mts --target utils
```
```bash
# preview changes without writing
pnpm mts src --dry-run
```
```bash
# skip ts-morph type refinement
pnpm mts src --no-refine
```
```bash
# skip `eslint --fix` post-processing  
pnpm mts src --no-lint
```
```bash
# enable discord.js-specific transforms (setColor, setStyle, addFields casts)
pnpm mts src --discord
```
```bash
# show version
pnpm mts --version
```
```bash
# show help
pnpm mts --help
```

## what it does

```
.js/.jsx/.mjs/.cjs → parse (babel) → convert modules → inject types → generate .ts/.tsx/.mts/.cts
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

### discord.js compat (opt-in)
pass `--discord` to enable discord.js-specific transforms:
- `setColor('string')` → `setColor('string' as any)`
- `setStyle('Primary')` → `setStyle(ButtonStyle.Primary)`
- `.addFields({...})` → `.addFields({...} as any)`
- `.get()`, `.findOne()`, etc. → `as any` casts

### eslint integration
if eslint is installed in your project, `mts` will run `eslint --fix` on the migrated files automatically. if not, it skips silently.

## programmatic api

```typescript
import { migrateCode, codeToAST, injectTypes, convertModuleSystem } from 'mts-migrator';

// quick: convert a code string
const { code, errors } = migrateCode('const x = require("fs");');

// with discord.js compat
const { code: discordCode } = migrateCode(jsCode, { discordCompat: true });

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
- **.mjs/.cjs support**: handles all javascript file extensions

## what it doesn't do

- fix logic bugs in your code
- handle flow types (use flow-to-ts for that)
- replace manually-written type annotations
- guarantee zero `any` in output (but it tries hard)

## license

[AGPL-3.0](./LICENSE)

---

made with <3 by [laxenta inc](https://colorwall.xyz)
