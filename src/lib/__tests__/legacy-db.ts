import Database from "better-sqlite3";
import { testBank } from "./fixtures";

// Frozen pre-TypeORM schema. Never used to initialize normal test databases.
const legacySchemaV1 = `
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

export function createLegacyDatabase(filename: string, version: 1 | 2) {
  const db = new Database(filename);
  db.exec(legacySchemaV1);
  if (version === 2) db.exec(`
    ALTER TABLE simulations ADD COLUMN retried_from_simulation_id TEXT REFERENCES simulations(id);
    ALTER TABLE simulation_questions ADD COLUMN score_contribution REAL CHECK(score_contribution BETWEEN 0 AND 1);
  `);
  db.pragma(`user_version = ${version}`);
  const now = new Date().toISOString();
  const bank = testBank();
  db.prepare("INSERT INTO question_banks VALUES (?, 2, ?, ?, ?, ?, ?, ?)").run(bank.id, bank.title, bank.description, bank.certification.name, bank.certification.code, now, now);
  for (const number of [1, 2]) {
    const value = testBank(number, number === 2 ? " UPDATED" : "");
    db.prepare("INSERT INTO question_bank_versions VALUES (?, ?, 1, ?, ?, ?, ?, ?)").run(value.id, number, value.title, value.description, value.certification.name, value.certification.code, now);
    for (const q of value.questions) {
      db.prepare("INSERT INTO questions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(value.id, number, q.id, q.domain, q.topic, q.difficulty, q.type, q.question, q.explanation, q.learnReference?.title ?? null, q.learnReference?.url ?? null, JSON.stringify(q.correctAnswers));
      q.answers.forEach((a, i) => db.prepare("INSERT INTO question_options VALUES (?, ?, ?, ?, ?, ?)").run(value.id, number, q.id, a.id, a.text, i));
    }
  }
  const q = bank.questions[1];
  const snapshot = { bankTitle: bank.title, certification: bank.certification, id: q.id, domain: q.domain, topic: q.topic, difficulty: q.difficulty, type: q.type, question: q.question, answers: q.answers, correctAnswers: q.correctAnswers, explanation: q.explanation, learnReference: q.learnReference };
  const filters = { mode: "exam", questionCount: 1, bankIds: [bank.id], durationMinutes: 30 };
  const sessions = [
    { id: "complete-exam", mode: "exam", complete: true, correct: 0, score: version === 1 ? 0 : 50 },
    { id: "complete-training", mode: "training", complete: true, correct: 1, score: 100 },
    { id: "active-training", mode: "training", complete: false, correct: null, score: null },
    { id: "active-exam", mode: "exam", complete: false, correct: null, score: null },
    ...(version === 2 ? [{ id: "retry", mode: "exam", complete: false, correct: null, score: null }] : []),
  ];
  for (const s of sessions) {
    db.prepare("INSERT INTO simulations (id, mode, status, created_at, started_at, completed_at, duration_limit_seconds, current_position, certification_codes, filters_json, score_percent) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)")
      .run(s.id, s.mode, s.complete ? "completed" : "in-progress", now, now, s.complete ? now : null, s.mode === "exam" ? 1800 : null, JSON.stringify(["TEST"]), JSON.stringify({ ...filters, mode: s.mode }), s.score);
    db.prepare("INSERT INTO simulation_questions (simulation_id, position, source_bank_id, source_bank_version, source_question_id, snapshot_json, is_locked, is_correct, for_review) VALUES (?, 0, ?, 1, ?, ?, ?, ?, ?)")
      .run(s.id, bank.id, q.id, JSON.stringify(snapshot), s.complete ? 1 : 0, s.correct, s.mode === "exam" ? 1 : 0);
    if (s.id !== "retry") for (const answer of s.correct === 1 ? ["a", "c"] : ["a", "b"]) {
      db.prepare("INSERT INTO simulation_answers VALUES (?, 0, ?, ?)").run(s.id, answer, now);
    }
    if (version === 2 && s.complete) db.prepare("UPDATE simulation_questions SET score_contribution = ? WHERE simulation_id = ?").run(s.score! / 100, s.id);
  }
  if (version === 2) db.prepare("UPDATE simulations SET retried_from_simulation_id = 'complete-exam' WHERE id = 'retry'").run();
  return db;
}
