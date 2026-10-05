import { TypeORMError } from "typeorm";
import { NextResponse } from "next/server";
import { getDataSource } from "@/lib/db";
import { retrySimulation } from "@/lib/simulation-service";

export const runtime = "nodejs";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    return NextResponse.json({ id: await retrySimulation(await getDataSource(), id) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error && !(error instanceof TypeORMError) ? error.message : "Could not retry simulation";
    return NextResponse.json({ error: message }, { status: message === "Simulation not found" ? 404 : 400 });
  }
}
