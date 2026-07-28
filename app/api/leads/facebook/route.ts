// app/api/leads/facebook/route.ts — ingest leadów z formularzy błyskawicznych
// Facebooka. Wołany przez scenariusz w Make.com (moduł „Facebook Lead Ads →
// Watch Leads” + HTTP Request).
//
// Auth: nagłówek X-API-Key == FB_LEADS_KEY (albo Authorization: Bearer <klucz>).
// Działa na service_role (omija RLS) — WYŁĄCZNIE server.
//
// Idempotentny: ten sam `leadgen_id` nigdy nie utworzy drugiego deala, więc
// ponowienia z Make są bezpieczne.
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { checkFbLeadsApiKey } from "@/lib/fbLeadsAuth";
import { parseFbLeadPayload } from "@/lib/fbFieldMapping";
import { ingestFbLead, type FbIngestResult } from "@/lib/server/fbLeads";

export const dynamic = "force-dynamic";

// Payload z Make bywa pojedynczym leadem, tablicą (agregator) albo obiektem
// z tablicą w środku. Rozpakowujemy wszystkie warianty, żeby konfiguracja
// scenariusza nie była źródłem cichych porażek.
function extractLeads(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.filter(isObject);
  if (!isObject(body)) return [];

  for (const key of ["leads", "data", "items", "bundle"]) {
    const v = (body as Record<string, unknown>)[key];
    if (Array.isArray(v)) return v.filter(isObject);
  }

  // Surowa koperta webhooka Page (object/entry/changes) — wyciągamy `value`
  // każdej zmiany typu `leadgen`.
  const entry = (body as Record<string, unknown>).entry;
  if (Array.isArray(entry)) {
    const out: Record<string, unknown>[] = [];
    for (const e of entry) {
      const changes = isObject(e) ? (e as Record<string, unknown>).changes : null;
      if (!Array.isArray(changes)) continue;
      for (const c of changes) {
        const value = isObject(c) ? (c as Record<string, unknown>).value : null;
        if (isObject(value)) out.push(value as Record<string, unknown>);
      }
    }
    if (out.length > 0) return out;
  }

  return [body as Record<string, unknown>];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export async function POST(req: Request) {
  const authError = checkFbLeadsApiKey(req);
  if (authError) return authError;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }

  const rawLeads = extractLeads(body);
  if (rawLeads.length === 0) {
    return NextResponse.json({ error: "Brak leadów w payloadzie" }, { status: 400 });
  }

  const db = createSupabaseAdmin();

  // Solo-admin: wszystkie dane należą do jedynego konta w auth.users
  // (ten sam mechanizm co import prospektów).
  const { data: usersRes, error: usersErr } = await db.auth.admin.listUsers();
  const owner = usersRes?.users?.[0]?.id;
  if (usersErr || !owner) {
    console.error("[leads/facebook] Nie znaleziono właściciela", usersErr);
    return NextResponse.json({ error: "Błąd serwera" }, { status: 500 });
  }

  // Każdy lead osobno — błąd jednego nie może przerwać całej partii (Make
  // wysyła paczki, a odrzucenie całości oznaczałoby utratę pozostałych).
  const results: FbIngestResult[] = [];
  for (const raw of rawLeads) {
    const lead = parseFbLeadPayload(raw);
    if (!lead) {
      results.push({
        lead_id: "",
        status: "error",
        error: "Brak leadgen_id — bez niego nie da się odesłać sygnału jakości do Meta",
      });
      continue;
    }
    if (Object.keys(lead.answers).length === 0) {
      results.push({ lead_id: lead.leadId, status: "error", error: "Brak field_data (odpowiedzi z formularza)" });
      continue;
    }
    try {
      results.push(await ingestFbLead(db, owner, lead));
    } catch (e) {
      console.error("[leads/facebook]", lead.leadId, e);
      results.push({
        lead_id: lead.leadId,
        status: "error",
        error: e instanceof Error ? e.message : "Błąd serwera",
      });
    }
  }

  const failed = results.filter((r) => r.status === "error").length;
  // 207 gdy część partii padła — Make widzi wtedy różnicę między „wszystko OK”
  // a „część leadów przepadła” i może uruchomić obsługę błędu.
  return NextResponse.json(
    { ok: failed === 0, received: results.length, failed, results },
    { status: failed === 0 ? 200 : failed === results.length ? 500 : 207 }
  );
}
