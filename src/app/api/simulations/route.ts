import { TypeORMError } from "typeorm";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getDataSource } from "@/lib/db";
import { createSimulation } from "@/lib/simulation-service";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const id = await createSimulation(await getDataSource(), await request.json());
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    const message = error instanceof ZodError ? error.issues.map((issue) => issue.message).join(", ") : error instanceof Error && !(error instanceof TypeORMError) ? error.message : "Could not create simulation";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
