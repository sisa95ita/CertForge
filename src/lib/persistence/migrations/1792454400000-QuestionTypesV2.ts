import { TableCheck, TableColumn, type MigrationInterface, type QueryRunner } from "typeorm";

export class QuestionTypesV21792454400000 implements MigrationInterface {
  readonly name = "QuestionTypesV21792454400000";

  async up(runner: QueryRunner): Promise<void> {
    const table = await runner.getTable("questions");
    if (!table) throw new Error("Questions table is missing");
    // SQLite requires a table rebuild for CHECK changes. QueryRunner copies rows
    // and restores indexes; the driver's migration hooks manage foreign keys.
    const typeChecks = table.checks.filter((check) => /\btype\b/.test(check.expression ?? ""));
    if (typeChecks.length) await runner.dropCheckConstraints("questions", typeChecks);
    await runner.createCheckConstraint("questions", new TableCheck({
      name: "CHK_questions_type",
      expression: "type IN ('single-choice', 'multiple-choice', 'yes-no-matrix', 'statement-completion')",
    }));
    await runner.addColumn("questions", new TableColumn({ name: "statements_json", type: "text", isNullable: true }));
  }

  async down(): Promise<void> {
    // Reverting after V2 imports would invalidate banks and destroy statement data.
    throw new Error("Question types V2 cannot be reverted without losing question data");
  }
}
