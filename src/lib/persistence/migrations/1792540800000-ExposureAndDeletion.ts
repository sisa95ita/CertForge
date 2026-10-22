import { TableForeignKey, TableIndex, type MigrationInterface, type QueryRunner } from "typeorm";

export class ExposureAndDeletion1792540800000 implements MigrationInterface {
  readonly name = "ExposureAndDeletion1792540800000";

  async up(runner: QueryRunner): Promise<void> {
    const table = await runner.getTable("simulations");
    if (!table) throw new Error("Simulations table is missing");
    const previous = table.foreignKeys.filter((key) => key.columnNames.includes("retried_from_simulation_id"));
    if (previous.length) await runner.dropForeignKeys(table, previous);
    await runner.createForeignKey("simulations", new TableForeignKey({
      name: "FK_simulations_retry", columnNames: ["retried_from_simulation_id"],
      referencedTableName: "simulations", referencedColumnNames: ["id"],
      onDelete: "SET NULL", onUpdate: "NO ACTION",
    }));
    // Existing snapshots already retain source UUID and external question ID.
    // No catalog join or guessed legacy backfill is necessary.
    await runner.createIndex("simulation_questions", new TableIndex({
      name: "idx_simulation_questions_exposure", columnNames: ["source_bank_id", "source_question_id"],
    }));
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.dropIndex("simulation_questions", "idx_simulation_questions_exposure");
    const table = await runner.getTable("simulations");
    const key = table?.foreignKeys.find((fk) => fk.columnNames.includes("retried_from_simulation_id"));
    if (key) await runner.dropForeignKey("simulations", key);
    await runner.createForeignKey("simulations", new TableForeignKey({
      columnNames: ["retried_from_simulation_id"], referencedTableName: "simulations",
      referencedColumnNames: ["id"], onDelete: "NO ACTION", onUpdate: "NO ACTION",
    }));
  }
}
