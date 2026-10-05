import { withDatabase, type CertForgeDatabase } from "./db";
import { SimulationEntity, SimulationQuestionEntity } from "./persistence/entities";

interface HistoryRow {
  id: string; mode: "training" | "exam"; status: "in-progress" | "completed"; createdAt: string;
  startedAt: string; completedAt: string | null; scorePercent: number | null; certifications: string; questionCount: number;
}

export interface HistoryItem {
  id: string; mode: "training" | "exam"; status: "in-progress" | "completed"; createdAt: string;
  certifications: string[]; scorePercent: number | null; questionCount: number; durationSeconds: number;
}

async function listSimulationsOperation(db: CertForgeDatabase): Promise<HistoryItem[]> {
  const rows = await db.getRepository(SimulationEntity).createQueryBuilder("s")
    .innerJoin("s.questions", "q")
    .select("s.id", "id").addSelect("s.mode", "mode").addSelect("s.status", "status")
    .addSelect("s.created_at", "createdAt").addSelect("s.started_at", "startedAt").addSelect("s.completed_at", "completedAt")
    .addSelect("s.score_percent", "scorePercent").addSelect("s.certification_codes", "certifications")
    .addSelect("COUNT(q.position)", "questionCount").groupBy("s.id").orderBy("s.created_at", "DESC").getRawMany<HistoryRow>();
  return rows.map((row) => ({
    id: row.id, mode: row.mode, status: row.status, createdAt: row.createdAt,
    certifications: JSON.parse(row.certifications) as string[], scorePercent: row.scorePercent, questionCount: row.questionCount,
    durationSeconds: Math.max(0, Math.round(((row.completedAt ? new Date(row.completedAt) : new Date()).getTime() - new Date(row.startedAt).getTime()) / 1000)),
  }));
}

async function progressOverviewOperation(db: CertForgeDatabase) {
  const items = (await listSimulationsOperation(db)).filter((item) => item.status === "completed");
  const average = items.length ? items.reduce((sum, item) => sum + (item.scorePercent ?? 0), 0) / items.length : 0;
  const byMode = (["training", "exam"] as const).map((mode) => {
    const matching = items.filter((item) => item.mode === mode);
    return { mode, count: matching.length, average: matching.length ? matching.reduce((sum, item) => sum + (item.scorePercent ?? 0), 0) / matching.length : 0 };
  });
  const detailRows = await db.getRepository(SimulationQuestionEntity).createQueryBuilder("q")
    .innerJoin("q.simulation", "s").where("s.status = :status", { status: "completed" }).getMany();
  function grouped(field: "domain" | "topic") {
    const values = new Map<string, { correct: number; credit: number; total: number }>();
    for (const row of detailRows) {
      const name = row.snapshot_json[field];
      const value = values.get(name) ?? { correct: 0, credit: 0, total: 0 };
      value.total++; value.correct += row.is_correct ? 1 : 0; value.credit += row.score_contribution ?? (row.is_correct ? 1 : 0); values.set(name, value);
    }
    return [...values.entries()].map(([name, value]) => ({ name, ...value, percent: value.credit / value.total * 100 })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }
  const recentAverage = items.length ? items.slice(0, 5).reduce((sum, item) => sum + (item.scorePercent ?? 0), 0) / Math.min(items.length, 5) : 0;
  return { average, recentAverage, completed: items.length, recent: items.slice(0, 5), byMode, byDomain: grouped("domain"), byTopic: grouped("topic") };
}

export function listSimulations(db: CertForgeDatabase) { return withDatabase(db, () => listSimulationsOperation(db)); }
export function progressOverview(db: CertForgeDatabase) { return withDatabase(db, () => progressOverviewOperation(db)); }
