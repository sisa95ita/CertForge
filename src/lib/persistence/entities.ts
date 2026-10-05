import { EntitySchema, type EntitySchemaColumnOptions } from "typeorm";
import type { QuestionType, SimulationMode, SnapshotQuestion } from "../types";
import { integerBoolean, jsonText } from "./transformers";

// Persistence properties deliberately match legacy column names. No generated identities,
// date conversion, eager loading, or ORM cascades are introduced.
export interface QuestionBank {
  id: string; current_version: number; title: string; description: string;
  certification_name: string; certification_code: string; created_at: string; updated_at: string;
  versions?: QuestionBankVersion[];
}
export interface QuestionBankVersion {
  bank_id: string; version: number; schema_version: number; title: string; description: string;
  certification_name: string; certification_code: string; imported_at: string;
  bank?: QuestionBank; questions?: Question[];
}
export interface Question {
  bank_id: string; bank_version: number; question_id: string; domain: string; topic: string;
  difficulty: string; type: QuestionType; text: string; explanation: string;
  reference_title: string | null; reference_url: string | null; correct_answers_json: string[];
  version?: QuestionBankVersion; options?: QuestionOption[];
}
export interface QuestionOption {
  bank_id: string; bank_version: number; question_id: string; option_id: string; text: string; display_order: number;
  question?: Question;
}
export interface Simulation {
  id: string; mode: SimulationMode; status: "in-progress" | "completed"; created_at: string; started_at: string;
  completed_at: string | null; duration_limit_seconds: number | null; current_position: number;
  certification_codes: string[]; filters_json: { mode: SimulationMode; questionCount: number; bankIds: string[]; certification?: string; domain?: string; topic?: string; durationMinutes?: number }; score_percent: number | null;
  retried_from_simulation_id: string | null; retriedFrom?: Simulation | null; questions?: SimulationQuestion[];
}
export interface SimulationQuestion {
  simulation_id: string; position: number; source_bank_id: string; source_bank_version: number;
  source_question_id: string; snapshot_json: SnapshotQuestion; is_locked: boolean; is_correct: boolean | null;
  for_review: boolean; score_contribution: number | null; simulation?: Simulation; answers?: SimulationAnswer[];
}
export interface SimulationAnswer {
  simulation_id: string; position: number; option_id: string; selected_at: string; question?: SimulationQuestion;
}
const text = (primary = false, nullable = false): EntitySchemaColumnOptions => ({ type: "text", primary, nullable });
const integer = (primary = false, nullable = false): EntitySchemaColumnOptions => ({ type: "integer", primary, nullable });
const bankKey = { bank_id: text(true), bank_version: integer(true), question_id: text(true) };
const bankJoin = [{ name: "bank_id", referencedColumnName: "bank_id" }, { name: "bank_version", referencedColumnName: "version" }];
const questionJoin = [{ name: "bank_id", referencedColumnName: "bank_id" }, { name: "bank_version", referencedColumnName: "bank_version" }, { name: "question_id", referencedColumnName: "question_id" }];
const simulationKey = { simulation_id: text(true), position: integer(true) };
const simulationJoin = [{ name: "simulation_id", referencedColumnName: "simulation_id" }, { name: "position", referencedColumnName: "position" }];
const booleanColumn = (nullable = false): EntitySchemaColumnOptions => ({ type: "integer", nullable, transformer: integerBoolean, ...(nullable ? {} : { default: 0 }) });

export const QuestionBankEntity = new EntitySchema<QuestionBank>({
  name: "QuestionBank", tableName: "question_banks",
  columns: { id: text(true, true), current_version: integer(), title: text(), description: text(), certification_name: text(), certification_code: text(), created_at: text(), updated_at: text() },
  relations: { versions: { type: "one-to-many", target: "QuestionBankVersion", inverseSide: "bank" } },
});
export const QuestionBankVersionEntity = new EntitySchema<QuestionBankVersion>({
  name: "QuestionBankVersion", tableName: "question_bank_versions",
  columns: { bank_id: text(true), version: integer(true), schema_version: integer(), title: text(), description: text(), certification_name: text(), certification_code: text(), imported_at: text() },
  relations: {
    bank: { type: "many-to-one", target: "QuestionBank", inverseSide: "versions", joinColumn: { name: "bank_id", referencedColumnName: "id" }, nullable: false, onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    questions: { type: "one-to-many", target: "Question", inverseSide: "version" },
  },
});
export const QuestionEntity = new EntitySchema<Question>({
  name: "Question", tableName: "questions",
  columns: { ...bankKey, domain: text(), topic: text(), difficulty: text(), type: text(), text: text(), explanation: text(), reference_title: text(false, true), reference_url: text(false, true), correct_answers_json: { type: "text", transformer: jsonText } },
  relations: {
    version: { type: "many-to-one", target: "QuestionBankVersion", inverseSide: "questions", joinColumn: bankJoin, nullable: false, onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    options: { type: "one-to-many", target: "QuestionOption", inverseSide: "question" },
  },
  indices: [{ name: "idx_questions_domain", columns: ["domain"] }, { name: "idx_questions_topic", columns: ["topic"] }],
  checks: [{ expression: "type IN ('single-choice', 'multiple-choice')" }],
});
export const QuestionOptionEntity = new EntitySchema<QuestionOption>({
  name: "QuestionOption", tableName: "question_options",
  columns: { ...bankKey, option_id: text(true), text: text(), display_order: integer() },
  relations: { question: { type: "many-to-one", target: "Question", inverseSide: "options", joinColumn: questionJoin, nullable: false, onDelete: "NO ACTION", onUpdate: "NO ACTION" } },
});
export const SimulationEntity = new EntitySchema<Simulation>({
  name: "Simulation", tableName: "simulations",
  columns: { id: text(true, true), mode: text(), status: text(), created_at: text(), started_at: text(), completed_at: text(false, true), duration_limit_seconds: integer(false, true), current_position: { type: "integer", default: 0 }, certification_codes: { type: "text", transformer: jsonText }, filters_json: { type: "text", transformer: jsonText }, score_percent: { type: "real", nullable: true }, retried_from_simulation_id: text(false, true) },
  relations: {
    questions: { type: "one-to-many", target: "SimulationQuestion", inverseSide: "simulation" },
    retriedFrom: { type: "many-to-one", target: "Simulation", joinColumn: { name: "retried_from_simulation_id", referencedColumnName: "id" }, nullable: true, onDelete: "NO ACTION", onUpdate: "NO ACTION" },
  },
  indices: [{ name: "idx_simulations_status", columns: ["status", "created_at"] }],
  checks: [{ expression: "mode IN ('training', 'exam')" }, { expression: "status IN ('in-progress', 'completed')" }],
});
export const SimulationQuestionEntity = new EntitySchema<SimulationQuestion>({
  name: "SimulationQuestion", tableName: "simulation_questions",
  columns: { ...simulationKey, source_bank_id: text(), source_bank_version: integer(), source_question_id: text(), snapshot_json: { type: "text", transformer: jsonText }, is_locked: booleanColumn(), is_correct: booleanColumn(true), for_review: booleanColumn(), score_contribution: { type: "real", nullable: true } },
  relations: {
    simulation: { type: "many-to-one", target: "Simulation", inverseSide: "questions", joinColumn: { name: "simulation_id", referencedColumnName: "id" }, nullable: false, onDelete: "CASCADE", onUpdate: "NO ACTION" },
    answers: { type: "one-to-many", target: "SimulationAnswer", inverseSide: "question" },
  },
  checks: [{ expression: "score_contribution BETWEEN 0 AND 1" }],
});
export const SimulationAnswerEntity = new EntitySchema<SimulationAnswer>({
  name: "SimulationAnswer", tableName: "simulation_answers",
  columns: { ...simulationKey, option_id: text(true), selected_at: text() },
  relations: { question: { type: "many-to-one", target: "SimulationQuestion", inverseSide: "answers", joinColumn: simulationJoin, nullable: false, onDelete: "CASCADE", onUpdate: "NO ACTION" } },
});
export const entities = [QuestionBankEntity, QuestionBankVersionEntity, QuestionEntity, QuestionOptionEntity, SimulationEntity, SimulationQuestionEntity, SimulationAnswerEntity];
