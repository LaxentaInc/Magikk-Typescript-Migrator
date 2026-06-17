# Changelog

All notable changes to this project will be documented in this file.

## [2.2.0] — 2026-06-17

### Added
- `--discord` flag — discord.js-specific transforms (setColor, setStyle, addFields casts) are now **opt-in** instead of always running. pass `--discord` to enable them.
- `--version` / `-v` flag — prints the current version.
- `.mjs` / `.cjs` file support — files are migrated to `.mts` / `.cts` respectively.
- proper cli argument parsing via [commander](https://www.npmjs.com/package/commander) — unknown flags now error instead of being silently ignored.
- auto-detection of terminal color support via [picocolors](https://www.npmjs.com/package/picocolors) — replaces raw ANSI escape codes.
- `engines` field in package.json — requires Node >=18.
- config file ignore list now includes `.cjs` and `.mjs` variants (e.g. `vite.config.cjs`).
- `discordCompat` option available in the programmatic `migrateCode()` api.

### Changed
- file discovery now uses [fast-glob](https://www.npmjs.com/package/fast-glob) instead of a hand-rolled recursive directory walker — faster and handles edge cases better.
- eslint post-processing uses `execFileSync` with args array instead of string interpolation — prevents potential issues with special characters in file paths.

### Fixed
- broken markdown fence in README (the `--no-lint` example was missing a closing code block).

---

## [2.1.11] and earlier

initial releases with core functionality:
- commonjs → esm module conversion
- ast-based type inference
- jsdoc annotation extraction
- ts-morph type refinement
- eslint --fix post-processing
- backup and dry-run support
- migration report generation
