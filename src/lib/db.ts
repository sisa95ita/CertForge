import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type CertForgeDatabase = Database.Database;

const migrationV1 = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS question_banks (
  id TEXT PRIMARY KEY,
  current_version INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  certification_name TEXT NOT NULL,
  certification_code TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS question_bank_versions (
  bank_id TEXT NOT NULL REFERENCES question_banks(id),
  version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  certification_name TEXT NOT NULL,
  certification_code TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (bank_id, version)
);

CREATE TABLE IF NOT EXISTS questions (
  bank_id TEXT NOT NULL,
  bank_version INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  topic TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('single-choice', 'multiple-choice')),
  text TEXT NOT NULL,
  explanation TEXT NOT NULL,
  reference_title TEXT,
  reference_url TEXT,
  correct_answers_json TEXT NOT NULL,
  PRIMARY KEY (bank_id, bank_version, question_id),
  FOREIGN KEY (bank_id, bank_version) REFERENCES question_bank_versions(bank_id, version)
);

CREATE TABLE IF NOT EXISTS question_options (
  bank_id TEXT NOT NULL,
  bank_version INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  text TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  PRIMARY KEY (bank_id, bank_version, question_id, option_id),
  FOREIGN KEY (bank_id, bank_version, question_id) REFERENCES questions(bank_id, bank_version, question_id)
);

CREATE TABLE IF NOT EXISTS simulations (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK(mode IN ('training', 'exam')),
  status TEXT NOT NULL CHECK(status IN ('in-progress', 'completed')),
  created_at TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  duration_limit_seconds INTEGER,
  current_position INTEGER NOT NULL DEFAULT 0,
  certification_codes TEXT NOT NULL,
  filters_json TEXT NOT NULL,
  score_percent REAL
);

CREATE TABLE IF NOT EXISTS simulation_questions (
  simulation_id TEXT NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  source_bank_id TEXT NOT NULL,
  source_bank_version INTEGER NOT NULL,
  source_question_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  is_locked INTEGER NOT NULL DEFAULT 0,
  is_correct INTEGER,
  for_review INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (simulation_id, position)
);

CREATE TABLE IF NOT EXISTS simulation_answers (
  simulation_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  option_id TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  PRIMARY KEY (simulation_id, position, option_id),
  FOREIGN KEY (simulation_id, position) REFERENCES simulation_questions(simulation_id, position) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_questions_domain ON questions(domain);
CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions(topic);
CREATE INDEX IF NOT EXISTS idx_simulations_status ON simulations(status, created_at);
`;

export function migrateDatabase(db: CertForgeDatabase): void {
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version > 2) throw new Error(`Database schema version ${version} is newer than this CertForge build supports`);
  db.transaction(() => {
    if (version < 1) db.exec(migrationV1);
    if (version < 2) {
      db.exec(`
        ALTER TABLE simulations ADD COLUMN retried_from_simulation_id TEXT REFERENCES simulations(id);
        ALTER TABLE simulation_questions ADD COLUMN score_contribution REAL CHECK(score_contribution BETWEEN 0 AND 1);
        UPDATE simulation_questions SET score_contribution = is_correct WHERE is_correct IS NOT NULL;
      `);
    }
    db.pragma("user_version = 2");
  })();
}

function openDatabase(filename: string): CertForgeDatabase {
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrateDatabase(db);
  return db;
}

const globalForDb = globalThis as unknown as { certForgeDb?: CertForgeDatabase };

export function getDb(): CertForgeDatabase {
  if (!globalForDb.certForgeDb) {
    globalForDb.certForgeDb = openDatabase(process.env.CERTFORGE_DB_PATH ?? path.join(process.cwd(), "data", "certforge.db"));
  }
  return globalForDb.certForgeDb;
}

export function createTestDb(): CertForgeDatabase {
  return openDatabase(":memory:");
}
