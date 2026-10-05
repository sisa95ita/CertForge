import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DataSource } from "typeorm";
import { entities } from "./entities";
import { Baseline1791158400000 } from "./migrations/1791158400000-Baseline";

export function databasePath(): string {
  return process.env.CERTFORGE_DB_PATH ?? path.join(process.cwd(), "data", "certforge.db");
}

// Explicit imports also survive the Next.js production bundle. Register new migrations here.
export function createDataSource(filename = databasePath()): DataSource {
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true });
  return new DataSource({
    type: "better-sqlite3", database: filename, enableWAL: true,
    synchronize: false, migrationsRun: false,
    entities, migrations: [Baseline1791158400000],
  });
}

export async function initializeDatabase(source: DataSource): Promise<DataSource> {
  try {
    await source.initialize();
    await source.runMigrations();
    return source;
  } catch (error) {
    if (source.isInitialized) await source.destroy();
    throw error;
  }
}
