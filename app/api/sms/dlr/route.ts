// app/api/sms/dlr/route.ts — webhook raportów doręczeń (DLR) od SMSAPI.
// SMSAPI nie podpisuje callbacków, więc pochodzenie weryfikujemy SEKRETEM w URL
// (?token=SMS_DLR_SECRET). Endpoint jest IDEMPOTENTNY (ten sam DLR może przyjść
// wielokrotnie) i dla rozpoznanych payloadów ZAWSZE zwraca „OK", żeby provider
// przestał ponawiać. Działa na service_role (webhook jest nieuwierzytelniony).
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { getDlrSecret, getSmsProvider } from "@/lib/sms/provider";

export const dynamic = "force-dynamic";

// SMSAPI może wołać metodą GET (parametry w query) lub POST (form-urlencoded).
async function collectParams(req: Request): Promise<Record<string, string>> {
  const url = new URL(req.url);
  const out: Record<string, string> = {};
  for (const [k, v] of url.searchParams) out[k] = v;
  if (req.method === "POST") {
    const ct = req.headers.get("content-type") || "";
    if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
      const form = await req.formData().catch(() => null);
      if (form) for (const [k, v] of form.entries()) out[k] = String(v);
    } else if (ct.includes("application/json")) {
      const json = await req.json().catch(() => null);
      if (json && typeof json === "object") {
        for (const [k, v] of Object.entries(json)) out[k] = String(v);
      }
    }
  }
  return out;
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const secret = getDlrSecret();
  // Bez skonfigurowanego sekretu endpoint jest celowo zablokowany.
  if (!secret) return new Response("misconfigured", { status: 503 });
  if (url.searchParams.get("token") !== secret) {
    return new Response("forbidden", { status: 401 });
  }

  const params = await collectParams(req);
  const report = getSmsProvider().parseDeliveryWebhook(params);
  if (!report) {
    // Payload nierozpoznany — nie każemy providerowi ponawiać w nieskończoność.
    console.warn("[/api/sms/dlr] nierozpoznany payload", JSON.stringify(params).slice(0, 500));
    return new Response("OK");
  }

  const db = createSupabaseAdmin();
  const { data: message } = await db
    .from("sms_messages")
    .select("id, owner, status")
    .eq("provider_message_id", report.providerMessageId)
    .maybeSingle();

  if (!message) {
    // Nie znamy tej wiadomości (np. wysłana spoza tego środowiska). „OK" kończy ponawianie.
    console.warn(`[/api/sms/dlr] brak wiadomości provider_message_id=${report.providerMessageId}`);
    return new Response("OK");
  }

  // Idempotencja: ten sam DLR (dedupe_key) wstawiamy tylko raz.
  await db
    .from("sms_events")
    .upsert(
      {
        owner: message.owner,
        sms_message_id: message.id,
        status: report.statusName ?? report.status,
        status_name: report.statusName ?? null,
        raw_payload: report.raw,
        dedupe_key: report.dedupeKey,
      },
      { onConflict: "dedupe_key", ignoreDuplicates: true }
    );

  // Aktualizacja statusu wiadomości (idempotentna — ustawienie tego samego stanu bezpieczne).
  const patch: Record<string, unknown> = { status: report.status };
  if (report.status === "delivered") {
    patch.delivered_at = (report.deliveredAt ?? new Date()).toISOString();
  }
  await db.from("sms_messages").update(patch).eq("id", message.id);

  return new Response("OK");
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
