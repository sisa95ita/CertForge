import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getDb } from "@/lib/db";
import { createSimulation } from "@/lib/simulation-service";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const id = createSimulation(getDb(), await request.json());
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    const message = error instanceof ZodError ? error.issues.map((issue) => issue.message).join(", ") : error instanceof Error ? error.message : "Could not create simulation";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
