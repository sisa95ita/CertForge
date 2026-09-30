import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getCatalog } from "@/lib/simulation-service";

export const runtime = "nodejs";
export function GET() {
  try { return NextResponse.json(getCatalog(getDb())); }
  catch { return NextResponse.json({ error: "Could not load question banks" }, { status: 500 }); }
}
