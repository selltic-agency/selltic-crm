// app/api/prospecting/[id]/status/route.ts
// Ręczna zmiana statusu prospektu z poziomu CRM (zalogowany user, RLS po owner).
import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";

const ALLOWED_STATUSES = ["contact_attempted", "not_interested"] as const;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
  }

  const { status, note } = await req.json();
  if (!ALLOWED_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Nieprawidłowy status" }, { status: 400 });
  }

  const update: Record<string, unknown> = { prospecting_status: status };
  if (note !== undefined) update.note = note;
  if (status === "contact_attempted") update.last_contact_attempt_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("prospects")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Nie udało się zaktualizować prospektu" }, { status: 500 });
  }
  return NextResponse.json(data);
}
