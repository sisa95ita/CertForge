import "server-only";
import type { DataSource } from "typeorm";
import { createDataSource, initializeDatabase } from "./persistence/data-source";

export type CertForgeDatabase = DataSource;
const state = globalThis as typeof globalThis & {
  certForgeDataSourcePromise?: Promise<DataSource>;
  certForgeOperations?: WeakMap<DataSource, Promise<void>>;
};

export function getDataSource(): Promise<DataSource> {
  return state.certForgeDataSourcePromise ??= initializeDatabase(createDataSource()).catch((error) => {
    // Allow another initialization attempt after a failure; concurrent callers share this one.
    state.certForgeDataSourcePromise = undefined;
    throw error;
  });
}

// better-sqlite3 shares one connection/query runner. Serialize complete service operations
// so overlapping requests cannot enter another request's transaction or see partial writes.
export async function withDatabase<T>(db: DataSource, operation: () => Promise<T>): Promise<T> {
  const queues = state.certForgeOperations ??= new WeakMap();
  const previous = queues.get(db) ?? Promise.resolve();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  queues.set(db, pending);
  await previous;
  try { return await operation(); }
  finally { release(); if (queues.get(db) === pending) queues.delete(db); }
}
