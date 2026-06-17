import type { File, TSType } from '@babel/types';
import type { NodePath, TraverseOptions } from '@babel/traverse';

// -- parse types --

export interface ParseResult {
  ast: File | null;
  errors: ParseError[];
}

export interface ParseError {
  message: string;
  line?: number;
  column?: number;
  fatal?: boolean;
}

export interface ParseOptions {
  isReact?: boolean;
  filePath?: string;
}

// -- migration types --

export interface MigrationResult {
  source: string;
  target: string;
  status: MigrationStatus;
  errors: string[];
  warnings: string[];
  refinedTypes?: number;
}

export type MigrationStatus =
  | 'unknown'
  | 'migrated'
  | 'migrated-reexport'
  | 'skipped-existing'
  | 'skipped-config'
  | 'error-read'
  | 'error-parse'
  | 'error-transform'
  | 'error-generate'
  | 'error-write';

export interface MigrationReport {
  timestamp: string;
  targetDir: string;
  backupDir: string;
  elapsedSeconds: number;
  summary: {
    total: number;
    migrated: number;
    skipped: number;
    errors: number;
    typesRefined: number;
  };
  files: MigrationResult[];
}

// -- jsdoc types --

export interface JSDocInfo {
  params: Record<string, TSType>;
  returnType: TSType | null;
}

// -- transform options --

export interface TransformOptions {
  discordCompat?: boolean;
}

// -- cli types --

export interface CliArgs {
  target: string;
  dryRun: boolean;
  skipRefine: boolean;
  skipLint: boolean;
  discord: boolean;
}
