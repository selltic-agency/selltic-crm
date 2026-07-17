// app/api/sms/config/route.ts — niewrażliwa konfiguracja SMS dla klienta:
// nazwa nadawcy (read-only w UI), tryb testowy oraz czy bramka jest w ogóle
// skonfigurowana (token obecny). NIGDY nie zwraca tokenu. Uwierzytelnione.
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { loadSmsConfig } from "@/lib/sms/config";

export async function GET() {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  const config = await loadSmsConfig(supabase, user.id);
  return NextResponse.json({
    sender: config.sender,
    testMode: config.testMode,
    configured: !!config.token,
  });
}
