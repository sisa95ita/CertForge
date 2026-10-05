import { createDataSource, initializeDatabase } from "../persistence/data-source";

export function createTestDb() {
  return initializeDatabase(createDataSource(":memory:"));
}
