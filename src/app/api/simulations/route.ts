import { TypeORMError } from "typeorm";
import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { getDataSource } from "@/lib/db";
import { confirmSimulation, createSimulation, RepetitionConfirmationRequiredError } from "@/lib/simulation-service";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body: unknown = await request.json();
    const db = await getDataSource();
    const id = typeof body === "object" && body !== null && "selectionToken" in body
      ? await confirmSimulation(db, z.object({ selectionToken: z.string() }).parse(body).selectionToken)
      : await createSimulation(db, body);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    if (error instanceof RepetitionConfirmationRequiredError) return NextResponse.json({ preview: error.preview });
    const message = error instanceof ZodError ? error.issues.map((issue) => issue.message).join(", ") : error instanceof Error && !(error instanceof TypeORMError) ? error.message : "Could not create simulation";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
