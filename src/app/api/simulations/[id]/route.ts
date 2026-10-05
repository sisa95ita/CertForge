import { TypeORMError } from "typeorm";
import { NextResponse } from "next/server";
import { getDataSource } from "@/lib/db";
import { confirmTrainingAnswer, getSimulation, saveAnswers, setCurrentPosition, setReviewFlag, submitSimulation } from "@/lib/simulation-service";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const simulation = await getSimulation(await getDataSource(), id);
    return simulation ? NextResponse.json(simulation) : NextResponse.json({ error: "Simulation not found" }, { status: 404 });
  } catch { return NextResponse.json({ error: "Could not load simulation" }, { status: 500 }); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    const body = await request.json() as { action?: string; position?: number; answers?: string[]; value?: boolean };
    if (body.action === "answers" && Number.isInteger(body.position) && Array.isArray(body.answers)) await saveAnswers(await getDataSource(), id, body.position!, body.answers);
    else if (body.action === "navigate" && Number.isInteger(body.position)) await setCurrentPosition(await getDataSource(), id, body.position!);
    else if (body.action === "review" && Number.isInteger(body.position) && typeof body.value === "boolean") await setReviewFlag(await getDataSource(), id, body.position!, body.value);
    else if (body.action === "confirm" && Number.isInteger(body.position)) await confirmTrainingAnswer(await getDataSource(), id, body.position!);
    else if (body.action === "submit") await submitSimulation(await getDataSource(), id);
    else return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    return NextResponse.json(await getSimulation(await getDataSource(), id));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error && !(error instanceof TypeORMError) ? error.message : "Could not update simulation" }, { status: 400 });
  }
}
