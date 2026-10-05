import { NextResponse } from "next/server";
import { getDataSource } from "@/lib/db";
import { importQuestionBank, type ImportResult } from "@/lib/import-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const data = await request.formData();
    const files = data.getAll("files").filter((entry): entry is File => entry instanceof File);
    if (!files.length) return NextResponse.json({ error: "Choose at least one JSON file" }, { status: 400 });
    const results: ImportResult[] = [];
    for (const file of files) {
      try {
        if (!file.name.toLowerCase().endsWith(".json")) {
          results.push({ status: "failed", title: file.name, errors: ["Only .json files are supported"] });
          continue;
        }
        const value: unknown = JSON.parse(await file.text());
        results.push(await importQuestionBank(await getDataSource(), value));
      } catch (error) {
        results.push({ status: "failed", title: file.name, errors: [error instanceof SyntaxError ? `Malformed JSON: ${error.message}` : "Could not read this file"] });
      }
    }
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "The import could not be processed" }, { status: 500 });
  }
}
