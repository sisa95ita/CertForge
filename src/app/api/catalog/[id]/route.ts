import { NextResponse } from "next/server";
import { TypeORMError } from "typeorm";
import { getDataSource } from "@/lib/db";
import { deleteQuestionBank } from "@/lib/deletion-service";

export const runtime = "nodejs";

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await deleteQuestionBank(await getDataSource(), (await context.params).id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error && !(error instanceof TypeORMError) ? error.message : "deleteFailed";
    return NextResponse.json({ error: message }, { status: message === "questionBankNotFound" ? 404 : 400 });
  }
}
