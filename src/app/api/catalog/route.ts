import { NextResponse } from "next/server";
import { getDataSource } from "@/lib/db";
import { getCatalog } from "@/lib/simulation-service";

export const runtime = "nodejs";
export async function GET() {
  try { return NextResponse.json(await getCatalog(await getDataSource())); }
  catch { return NextResponse.json({ error: "Could not load question banks" }, { status: 500 }); }
}
