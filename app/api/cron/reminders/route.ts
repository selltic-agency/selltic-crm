// app/api/cron/reminders/route.ts — placeholder crona (pełna logika w Fazie 6).
// Wywoływany co godzinę przez Vercel Cron (patrz vercel.json).
// Na razie tylko potwierdza, że endpoint istnieje, żeby cron miał poprawny cel.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, reminders: 0 });
}
