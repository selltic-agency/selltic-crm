// app/api/sms/dlr/route.ts — webhook raportów doręczeń (DLR) od SMSAPI.
// SMSAPI nie podpisuje callbacków, więc pochodzenie weryfikujemy SEKRETEM w URL
// (?token=SMS_DLR_SECRET). Endpoint jest IDEMPOTENTNY (ten sam DLR może przyjść
// wielokrotnie) i dla rozpoznanych payloadów ZAWSZE zwraca „OK", żeby provider
// przestał ponawiać. Działa na service_role (webhook jest nieuwierzytelniony).
import { createSupabaseAdmin } from "@/lib/supabase/server";
import { createSmsProvider } from "@/lib/sms/provider";
import { envSmsConfig, loadSmsConfig } from "@/lib/sms/config";

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
  const token = url.searchParams.get("token") || "";
  if (!token) return new Response("forbidden", { status: 401 });

  // Parsowanie payloadu nie wymaga tokenu ani konfiguracji właściciela.
  const params = await collectParams(req);
  const report = createSmsProvider(envSmsConfig()).parseDeliveryWebhook(params);
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
    // Nieznana wiadomość — bez mutacji. Weryfikujemy token sekretem ENV (gdy ustawiony),
    // po czym „OK" kończy ponawianie (nic nie ujawniamy).
    const envSecret = envSmsConfig().dlrSecret;
    if (envSecret && token !== envSecret) return new Response("forbidden", { status: 401 });
    console.warn(`[/api/sms/dlr] brak wiadomości provider_message_id=${report.providerMessageId}`);
    return new Response("OK");
  }

  // Weryfikacja pochodzenia: token musi zgadzać się z sekretem DLR WŁAŚCICIELA
  // wiadomości (app_settings, fallback ENV). Bez skonfigurowanego sekretu blokujemy.
  const config = await loadSmsConfig(db, message.owner);
  if (!config.dlrSecret) return new Response("misconfigured", { status: 503 });
  if (token !== config.dlrSecret) return new Response("forbidden", { status: 401 });

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
