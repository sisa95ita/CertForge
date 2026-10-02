import type { SimulationView } from "./types";

export interface Breakdown { name: string; correct: number; credit: number; total: number; percent: number }

function group(simulation: SimulationView, key: "domain" | "topic"): Breakdown[] {
  const groups = new Map<string, { correct: number; credit: number; total: number }>();
  for (const item of simulation.questions) {
    const name = item.question[key];
    const value = groups.get(name) ?? { correct: 0, credit: 0, total: 0 };
    value.total++;
    if (item.correct) value.correct++;
    value.credit += item.evaluation?.score ?? (item.correct ? 1 : 0);
    groups.set(name, value);
  }
  return [...groups.entries()].map(([name, value]) => ({ ...value, name, percent: value.total ? value.credit / value.total * 100 : 0 })).sort((a, b) => a.name.localeCompare(b.name));
}

export function simulationStatistics(simulation: SimulationView) {
  const correct = simulation.questions.filter((question) => question.correct).length;
  const partial = simulation.questions.filter((question) => question.evaluation?.status === "partial").length;
  const credit = simulation.questions.reduce((sum, question) => sum + (question.evaluation?.score ?? (question.correct ? 1 : 0)), 0);
  const total = simulation.questions.length;
  const end = simulation.completedAt ? new Date(simulation.completedAt).getTime() : Date.now();
  const durationSeconds = Math.max(0, Math.round((end - new Date(simulation.startedAt).getTime()) / 1000));
  return {
    correct,
    partial,
    credit,
    incorrect: total - correct - partial,
    total,
    percent: total ? credit / total * 100 : 0,
    durationSeconds,
    byDomain: group(simulation, "domain"),
    byTopic: group(simulation, "topic"),
  };
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m ${remaining}s`;
}
