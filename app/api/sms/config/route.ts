// app/api/sms/config/route.ts — niewrażliwa konfiguracja SMS dla klienta:
// nazwa nadawcy (read-only w UI) + informacja o trybie testowym. NIGDY nie
// zwraca tokenu. Uwierzytelnione (sesja właściciela).
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { getSmsSender, isSmsTestMode } from "@/lib/sms/provider";

export async function GET() {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Brak autoryzacji." }, { status: 401 });
  return NextResponse.json({ sender: getSmsSender(), testMode: isSmsTestMode() });
}
