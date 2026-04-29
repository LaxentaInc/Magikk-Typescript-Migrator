import type { File } from '@babel/types';

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

export interface MigrationResult {
  source: string;
  target: string;
  status: MigrationStatus;
  errors: string[];
  warnings: string[];
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
  };
  files: MigrationResult[];
}

export interface JSDocInfo {
  params: Record<string, import('@babel/types').TSType>;
  returnType: import('@babel/types').TSType | null;
}
