import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { retrySimulation } from "@/lib/simulation-service";

export const runtime = "nodejs";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try {
    return NextResponse.json({ id: retrySimulation(getDb(), id) }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not retry simulation";
    return NextResponse.json({ error: message }, { status: message === "Simulation not found" ? 404 : 400 });
  }
}
