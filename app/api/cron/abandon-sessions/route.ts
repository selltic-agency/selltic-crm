// app/api/cron/abandon-sessions/route.ts — §2. Przejście started → abandoned.
// Chronione sekretem (CRON_SECRET). Klient NIGDY nie robi tego przejścia — tylko ten job.
//
// Harmonogram: Vercel Cron na planie Hobby dopuszcza tylko zadania RAZ DZIENNIE,
// więc vercel.json wywołuje ten endpoint raz na dobę. Aby uzyskać docelową
// kadencję ~15 min (§2), można albo przejść na plan Vercel Pro i ustawić
// "*/15 * * * *", albo wywoływać ten sam URL zewnętrznym schedulerem
// (np. cron-job.org / GitHub Actions) z nagłówkiem Authorization: Bearer <CRON_SECRET>.
// Sam endpoint jest bezstanowy i można go bezpiecznie wołać dowolnie często.
//
// Dodatkowo (§6): dla świeżo porzuconych sesji z e-mailem/telefonem tworzy leada
// niekompletnego przez wspólną ścieżkę createLeadFromForm (moduł Leady, NIE Tryb
// dzwonienia). Bez auto-maila „dziękujemy”.
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { DEFAULT_ABANDON_MINUTES } from "@/lib/formSessions";
import { answersHaveContact, createLeadFromForm, stepQuestionAt } from "@/lib/server/leads";
import type { FormSchema } from "@/lib/forms";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    if (req.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Brak autoryzacji" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("[cron/abandon-sessions] Brak CRON_SECRET — endpoint zablokowany.");
    return NextResponse.json({ error: "Cron nie skonfigurowany" }, { status: 503 });
  }

  const db = createSupabaseAdmin();

  // Próg porzucenia per właściciel (domyślnie 30 min — konfigurowalny w app_settings).
  const { data: settings } = await db.from("app_settings").select("owner, form_abandon_minutes");
  const thresholdFor = new Map<string, number>(
    (settings ?? []).map((s) => [s.owner as string, (s.form_abandon_minutes as number) ?? DEFAULT_ABANDON_MINUTES])
  );

  // Kandydaci: sesje „started” bezczynne dłużej niż najkrótszy możliwy próg.
  // Bierzemy generyczne 1 min i filtrujemy per właściciel poniżej (mały wolumen).
  const globalMin = Math.min(DEFAULT_ABANDON_MINUTES, ...[...thresholdFor.values()].filter((n) => n > 0), DEFAULT_ABANDON_MINUTES);
  const cutoffGlobal = new Date(Date.now() - globalMin * 60_000).toISOString();

  const { data: candidates, error } = await db
    .from("form_sessions")
    .select("id, form_id, owner, last_seen_at, last_step, total_steps, answers")
    .eq("status", "started")
    .lt("last_seen_at", cutoffGlobal)
    .limit(500);

  if (error) {
    console.error("[cron/abandon-sessions]", error);
    return NextResponse.json({ error: "Błąd zapytania" }, { status: 500 });
  }

  const now = Date.now();
  let abandoned = 0;
  let leads = 0;

  // Cache schematów formularzy, żeby nie pobierać ich wielokrotnie.
  const formCache = new Map<string, { slug: string | null; title: string | null; schema: FormSchema } | null>();

  for (const s of candidates ?? []) {
    const minutes = thresholdFor.get(s.owner as string) ?? DEFAULT_ABANDON_MINUTES;
    const idleMin = (now - new Date(s.last_seen_at as string).getTime()) / 60_000;
    if (idleMin < minutes) continue;

    // Oznacz jako porzuconą (to przejście chroni przed dublowaniem leadu).
    await db.from("form_sessions").update({ status: "abandoned" }).eq("id", s.id).eq("status", "started");
    abandoned++;

    const answers = (s.answers as Record<string, unknown>) || {};
    if (Object.keys(answers).length === 0) continue;

    // Pobierz schemat formularza (z cache).
    let form = formCache.get(s.form_id as string);
    if (form === undefined) {
      const { data: f } = await db
        .from("forms")
        .select("slug, title, published")
        .eq("id", s.form_id)
        .maybeSingle();
      form = f ? { slug: f.slug, title: f.title, schema: (f.published ?? { steps: [], theme: {} }) as FormSchema } : null;
      formCache.set(s.form_id as string, form);
    }
    if (!form) continue;

    // §6 — tylko gdy porzucona sesja zawiera e-mail lub telefon.
    if (!answersHaveContact(form.schema, answers)) continue;

    try {
      await createLeadFromForm({
        db,
        owner: s.owner as string,
        formId: s.form_id as string,
        formSlug: form.slug,
        formTitle: form.title,
        schema: form.schema,
        answers,
        incomplete: true,
        dropOff: {
          step: (s.last_step as number) ?? 0,
          total: (s.total_steps as number) ?? 0,
          question: stepQuestionAt(form.schema, (s.last_step as number) ?? 0),
        },
      });
      leads++;
    } catch (e) {
      console.error("[cron/abandon-sessions] lead", e);
    }
  }

  return NextResponse.json({ ok: true, abandoned, leads });
}
