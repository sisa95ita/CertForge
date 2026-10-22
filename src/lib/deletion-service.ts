import { withDatabase, type CertForgeDatabase } from "./db";
import { QuestionBankEntity, QuestionBankVersionEntity, QuestionEntity, QuestionOptionEntity, SimulationEntity } from "./persistence/entities";

export function deleteQuestionBank(db: CertForgeDatabase, id: string): Promise<void> {
  return withDatabase(db, () => db.transaction(async (manager) => {
    const banks = manager.getRepository(QuestionBankEntity);
    if (!await banks.existsBy({ id })) throw new Error("questionBankNotFound");
    // Catalog ownership only: simulation source IDs deliberately have no catalog FK.
    await manager.getRepository(QuestionOptionEntity).delete({ bank_id: id });
    await manager.getRepository(QuestionEntity).delete({ bank_id: id });
    await manager.getRepository(QuestionBankVersionEntity).delete({ bank_id: id });
    await banks.delete({ id });
  }));
}

export function deleteSimulation(db: CertForgeDatabase, id: string): Promise<void> {
  return withDatabase(db, () => db.transaction(async (manager) => {
    const simulations = manager.getRepository(SimulationEntity);
    const simulation = await simulations.findOneBy({ id });
    if (!simulation) throw new Error("Simulation not found");
    if (simulation.status !== "completed") throw new Error("deleteCompletedOnly");
    // SET NULL preserves retry descendants; CASCADE removes snapshots and answers.
    await simulations.delete({ id });
  }));
}
