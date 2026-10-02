import type { CertForgeDatabase } from "./db";
import type { SnapshotQuestion } from "./types";

interface HistoryRow {
  id: string; mode: "training" | "exam"; status: "in-progress" | "completed"; createdAt: string;
  startedAt: string; completedAt: string | null; scorePercent: number | null; certifications: string; questionCount: number;
}

export interface HistoryItem {
  id: string; mode: "training" | "exam"; status: "in-progress" | "completed"; createdAt: string;
  certifications: string[]; scorePercent: number | null; questionCount: number; durationSeconds: number;
}

export function listSimulations(db: CertForgeDatabase): HistoryItem[] {
  const rows = db.prepare(`SELECT s.id, s.mode, s.status, s.created_at AS createdAt, s.started_at AS startedAt, s.completed_at AS completedAt, s.score_percent AS scorePercent, s.certification_codes AS certifications, COUNT(q.position) AS questionCount FROM simulations s JOIN simulation_questions q ON q.simulation_id = s.id GROUP BY s.id ORDER BY s.created_at DESC`).all() as HistoryRow[];
  return rows.map((row) => ({
    id: row.id, mode: row.mode, status: row.status, createdAt: row.createdAt,
    certifications: JSON.parse(row.certifications) as string[], scorePercent: row.scorePercent, questionCount: row.questionCount,
    durationSeconds: Math.max(0, Math.round(((row.completedAt ? new Date(row.completedAt) : new Date()).getTime() - new Date(row.startedAt).getTime()) / 1000)),
  }));
}

export function progressOverview(db: CertForgeDatabase) {
  const items = listSimulations(db).filter((item) => item.status === "completed");
  const average = items.length ? items.reduce((sum, item) => sum + (item.scorePercent ?? 0), 0) / items.length : 0;
  const byMode = (["training", "exam"] as const).map((mode) => {
    const matching = items.filter((item) => item.mode === mode);
    return { mode, count: matching.length, average: matching.length ? matching.reduce((sum, item) => sum + (item.scorePercent ?? 0), 0) / matching.length : 0 };
  });
  const detailRows = db.prepare(`SELECT q.snapshot_json AS snapshot, q.is_correct AS isCorrect, q.score_contribution AS credit FROM simulation_questions q JOIN simulations s ON s.id = q.simulation_id WHERE s.status = 'completed'`).all() as { snapshot: string; isCorrect: number; credit: number | null }[];
  function grouped(field: "domain" | "topic") {
    const values = new Map<string, { correct: number; credit: number; total: number }>();
    for (const row of detailRows) {
      const name = (JSON.parse(row.snapshot) as SnapshotQuestion)[field];
      const value = values.get(name) ?? { correct: 0, credit: 0, total: 0 };
      value.total++; value.correct += row.isCorrect ? 1 : 0; value.credit += row.credit ?? (row.isCorrect ? 1 : 0); values.set(name, value);
    }
    return [...values.entries()].map(([name, value]) => ({ name, ...value, percent: value.credit / value.total * 100 })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }
  const recentAverage = items.length ? items.slice(0, 5).reduce((sum, item) => sum + (item.scorePercent ?? 0), 0) / Math.min(items.length, 5) : 0;
  return { average, recentAverage, completed: items.length, recent: items.slice(0, 5), byMode, byDomain: grouped("domain"), byTopic: grouped("topic") };
}
