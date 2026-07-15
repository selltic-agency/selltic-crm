// lib/server/meta.ts — §9. Server-side Meta CAPI + generyczny webhook.
// Rozwiązuje ustawienia per-form z fallbackiem globalnym (app_settings). Token
// CAPI czytany WYŁĄCZNIE tu (service_role) — nigdy nie trafia do klienta.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FormSchema, Step } from "@/lib/forms";
import { stepFields } from "@/lib/forms";
import {
  buildUserData,
  deriveFbc,
  sendCapiLead,
  type MetaConfig,
} from "@/lib/meta";

type Db = SupabaseClient;

// Bezpieczne, publiczne ustawienia Meta (bez tokenu) — do wstrzyknięcia Pixela.
export type PublicMetaConfig = { pixelId: string; eventsEnabled: boolean };

// Rozwiązuje pełną konfigurację Meta dla formularza: per-form → globalny fallback.
export async function resolveMetaConfig(db: Db, formId: string, owner: string): Promise<MetaConfig> {
  const [{ data: perForm }, { data: global }] = await Promise.all([
    db
      .from("form_meta_settings")
      .select("pixel_id, capi_token, test_event_code, events_enabled")
      .eq("form_id", formId)
      .maybeSingle(),
    db
      .from("app_settings")
      .select("meta_pixel_id, meta_capi_token, meta_test_event_code, meta_events_enabled")
      .eq("owner", owner)
      .maybeSingle(),
  ]);

  return {
    pixelId: perForm?.pixel_id || global?.meta_pixel_id || "",
    capiToken: perForm?.capi_token || global?.meta_capi_token || "",
    testEventCode: perForm?.test_event_code || global?.meta_test_event_code || undefined,
    eventsEnabled: perForm?.events_enabled ?? global?.meta_events_enabled ?? false,
  };
}

// Wersja bezpieczna dla klienta (tylko pixelId + flaga). Używana przez publiczną
// stronę do wstrzyknięcia Pixela — NIGDY nie zawiera tokenu.
export async function resolvePublicMetaConfig(db: Db, formId: string, owner: string): Promise<PublicMetaConfig> {
  const cfg = await resolveMetaConfig(db, formId, owner);
  return { pixelId: cfg.pixelId, eventsEnabled: cfg.eventsEnabled && !!cfg.pixelId };
}

// Wyciąga imię z odpowiedzi (pierwsze pole zmapowane na „name”, fallback: brak).
function firstNameFrom(answers: Record<string, unknown>, schema: FormSchema): string {
  const steps = (schema?.steps ?? []) as Step[];
  for (const s of steps) {
    for (const f of stepFields(s)) {
      if (f.mapping?.property === "name" || f.map === "name") {
        const v = answers[f.id];
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    }
  }
  return "";
}

// §9c. Wyślij zdarzenie „Lead” do CAPI i ZALOGUJ próbę jako form_event 'capi'
// (żeby cisza w Events Managerze była diagnozowalna). Fire-and-forget.
export async function fireCapiLead(
  db: Db,
  args: {
    form: { id: string; owner: string; title: string | null };
    sessionId: string;
    answers: Record<string, unknown>;
    schema: FormSchema;
    lead: { email: string; phone: string; name: string };
    meta?: Record<string, unknown>;
    clientIp?: string;
  }
): Promise<void> {
  try {
    const cfg = await resolveMetaConfig(db, args.form.id, args.form.owner);
    if (!cfg.eventsEnabled || !cfg.pixelId || !cfg.capiToken) return;

    const m = args.meta || {};
    const fbc = (m.fbc as string) || deriveFbc((m.fbclid as string) || null);
    const userData = buildUserData({
      email: args.lead.email,
      phone: args.lead.phone,
      firstName: firstNameFrom(args.answers, args.schema) || args.lead.name,
      fbp: (m.fbp as string) || null,
      fbc: fbc || null,
      clientIp: args.clientIp || (m.ip as string) || null,
      userAgent: (m.ua as string) || null,
    });

    const result = await sendCapiLead({
      config: cfg,
      eventId: args.sessionId,
      eventSourceUrl: (m.url as string) || null,
      userData,
      customData: { content_name: args.form.title || "" },
    });

    // Log próby jako zdarzenie (session_id musi wskazywać istniejącą sesję).
    await db.from("form_events").insert({
      session_id: args.sessionId,
      form_id: args.form.id,
      owner: args.form.owner,
      type: "capi",
      meta: { ok: result.ok, status: result.status ?? null, error: result.error ?? null },
    });
  } catch (e) {
    console.error("[fireCapiLead]", e);
  }
}

// §9d. Generyczny wychodzący webhook — POST JSON ze zgłoszeniem. Per-form URL z
// fallbackiem globalnym. Fire-and-forget.
export async function fireWebhook(
  db: Db,
  args: { formId: string; owner: string; payload: Record<string, unknown> }
): Promise<void> {
  try {
    const [{ data: perForm }, { data: global }] = await Promise.all([
      db.from("form_meta_settings").select("webhook_url").eq("form_id", args.formId).maybeSingle(),
      db.from("app_settings").select("webhook_url").eq("owner", args.owner).maybeSingle(),
    ]);
    const url = perForm?.webhook_url || global?.webhook_url || "";
    if (!url) return;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args.payload),
    });
  } catch (e) {
    console.error("[fireWebhook]", e);
  }
}
