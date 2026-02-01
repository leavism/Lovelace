/**
 * @file types.ts
 * @description Type definitions and error classes
 */

/**
 * Database-specific error types
 */
export class DatabaseConnectionError extends Error {
  constructor(cause?: Error) {
    super('Database connection failed');
    this.name = 'DatabaseConnectionError';
    this.cause = cause;
  }
}

export class DatabaseQueryError extends Error {
  constructor(operation: string, cause?: Error) {
    super(`Database query failed: ${operation}`);
    this.name = 'DatabaseQueryError';
    this.cause = cause;
  }
}

export class RecordNotFoundError extends Error {
  constructor(entity: string, identifier: string) {
    super(`${entity} not found: ${identifier}`);
    this.name = 'RecordNotFoundError';
  }
}

export class DuplicateRecordError extends Error {
  constructor(entity: string, identifier: string) {
    super(`${entity} already exists: ${identifier}`);
    this.name = 'DuplicateRecordError';
  }
}

/**
 * Result types for database operations
 */
export type DatabaseResult<T> =
  | { success: true; data: T }
  | { success: false; error: Error; retryable: boolean };

export type DatabaseWriteResult =
  | { success: true; affectedRows: number }
  | { success: false; error: Error; retryable: boolean };
