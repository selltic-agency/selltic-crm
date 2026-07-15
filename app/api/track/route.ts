// app/api/track/route.ts — §3. Publiczny endpoint śledzenia sesji/zdarzeń.
// Fire-and-forget z perspektywy klienta. Działa na service_role (omija RLS),
// więc WYŁĄCZNIE server-side — anonimowi nie mają bezpośredniego zapisu do
// form_sessions / form_events. Dla formularzy zarchiwizowanych/nieistniejących
// cicho zwraca 204 (bez zapisów). Nigdy nie zdradza szczegółów błędu.
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { SESSION_CONTINUITY_MINUTES, type SessionMeta } from "@/lib/formSessions";

export const dynamic = "force-dynamic";

// ── Limiter per IP (spójny z /api/submit) ──────────────────────────────────
const RATE_LIMIT = 120; // śledzenie generuje wiele zdarzeń — luźniejszy limit
const RATE_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
  }
  return recent.length > RATE_LIMIT;
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

// 204 bez treści — „cichy no-op”.
const noop = () => new NextResponse(null, { status: 204 });

type TrackKind = "view" | "step_view" | "step_complete";

export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    if (rateLimited(ip)) return noop();

    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== "object") return noop();

    const {
      formId,
      visitorId,
      sessionId,
      kind,
      stepIndex,
      totalSteps,
      answers,
      consent,
      meta,
    } = payload as {
      formId?: string;
      visitorId?: string;
      sessionId?: string;
      kind?: TrackKind;
      stepIndex?: number;
      totalSteps?: number;
      answers?: Record<string, unknown>;
      consent?: boolean;
      meta?: SessionMeta;
    };

    if (!formId || !visitorId || !kind) return noop();

    const db = createSupabaseAdmin();

    // Formularz musi istnieć, być opublikowany i NIE być zarchiwizowany.
    const { data: form } = await db
      .from("forms")
      .select("id, owner, status, archived_at")
      .eq("id", formId)
      .maybeSingle();
    if (!form || form.status !== "published" || form.archived_at) return noop();

    const nowIso = new Date().toISOString();
    const withIp: SessionMeta = { ...(meta || {}), ip };

    // ── Rozwiąż sesję: reużycie w oknie ciągłości (odświeżenie ≠ nowa sesja) ──
    let session = await resolveSession(db, {
      formId,
      owner: form.owner,
      visitorId,
      sessionId,
      metaOnCreate: withIp,
      totalSteps,
      nowIso,
    });
    if (!session) return noop();

    // ── Aktualizacje sesji zależne od rodzaju zdarzenia ──
    const update: Record<string, unknown> = { last_seen_at: nowIso };
    if (typeof totalSteps === "number") update.total_steps = totalSteps;
    if (typeof stepIndex === "number") {
      update.last_step = stepIndex;
      update.max_step = Math.max(session.max_step ?? 0, stepIndex);
    }
    if (typeof consent === "boolean") update.consent = consent;

    // Autosave częściowych odpowiedzi (§3) — jedyne źródło danych o porzuceniu.
    if (answers && typeof answers === "object") {
      const merged = { ...(session.answers || {}), ...answers };
      update.answers = merged;
      // Zapisano co najmniej jedną odpowiedź → status „started” (o ile nie completed).
      const hasAny = Object.values(merged).some(
        (v) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0)
      );
      if (hasAny && session.status === "viewed") update.status = "started";
    }
    // Zaktualizuj meta o cookies/consent, które mogły dojść później.
    if (meta) update.meta = { ...(session.meta || {}), ...withIp };

    await db.from("form_sessions").update(update).eq("id", session.id);

    // ── Zapis zdarzenia ──
    const eventType =
      kind === "view" ? "form_viewed" : kind === "step_view" ? "step_viewed" : "step_completed";
    await db.from("form_events").insert({
      session_id: session.id,
      form_id: formId,
      owner: form.owner,
      type: eventType,
      step_index: typeof stepIndex === "number" ? stepIndex : null,
      meta: {},
    });

    return NextResponse.json({ sessionId: session.id });
  } catch (e) {
    console.error("[/api/track]", e);
    // Nigdy nie zdradzaj szczegółów — śledzenie jest wtórne wobec wypełnienia.
    return noop();
  }
}

type SessionRow = {
  id: string;
  status: string;
  max_step: number;
  answers: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
};

// Reużycie istniejącej sesji tego samego gościa na tym formularzu w oknie 30 min,
// albo utworzenie nowej. Sesje ukończone nie są reużywane.
async function resolveSession(
  db: ReturnType<typeof createSupabaseAdmin>,
  args: {
    formId: string;
    owner: string;
    visitorId: string;
    sessionId?: string;
    metaOnCreate: SessionMeta;
    totalSteps?: number;
    nowIso: string;
  }
): Promise<SessionRow | null> {
  const { formId, owner, visitorId, sessionId, metaOnCreate, totalSteps } = args;

  // 1) Jawny sessionId (jeśli pasuje do formularza i nie jest ukończony).
  if (sessionId) {
    const { data } = await db
      .from("form_sessions")
      .select("id, status, max_step, answers, meta")
      .eq("id", sessionId)
      .eq("form_id", formId)
      .neq("status", "completed")
      .maybeSingle();
    if (data) return data as SessionRow;
  }

  // 2) Ostatnia aktywna sesja gościa w oknie ciągłości.
  const cutoff = new Date(Date.now() - SESSION_CONTINUITY_MINUTES * 60_000).toISOString();
  const { data: recent } = await db
    .from("form_sessions")
    .select("id, status, max_step, answers, meta")
    .eq("form_id", formId)
    .eq("visitor_id", visitorId)
    .neq("status", "completed")
    .gte("last_seen_at", cutoff)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recent) return recent as SessionRow;

  // 3) Nowa sesja.
  const { data: created } = await db
    .from("form_sessions")
    .insert({
      form_id: formId,
      owner,
      visitor_id: visitorId,
      status: "viewed",
      total_steps: typeof totalSteps === "number" ? totalSteps : 0,
      meta: metaOnCreate,
    })
    .select("id, status, max_step, answers, meta")
    .single();
  return (created as SessionRow) ?? null;
}
