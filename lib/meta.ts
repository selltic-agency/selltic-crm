// lib/meta.ts — §9. Meta Conversions API (server-side) + normalizacja PII.
// Token CAPI żyje WYŁĄCZNIE tu (server) — nigdy nie wraca do przeglądarki.
import { createHash } from "crypto";
import { digitsOnly } from "./phone";

// Ustawienia Meta rozwiązane dla formularza (per-form z fallbackiem globalnym).
export type MetaConfig = {
  pixelId: string;
  capiToken: string; // server-side only
  testEventCode?: string;
  eventsEnabled: boolean;
};

// SHA-256 (hex, lowercase) — format wymagany przez Meta dla danych użytkownika.
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// Normalizacja i hash: e-mail (trim + lowercase).
export function hashEmail(email: string): string | null {
  const e = (email || "").trim().toLowerCase();
  if (!e) return null;
  return sha256(e);
}

// §9c. Normalizacja telefonu do E.164 BEZ wiodącego plusa, przed hashem.
// Polskie 9-cyfrowe numery dostają prefiks kraju (48). Numery z własnym
// prefiksem (zaczynające się od „+”) zachowują swój kod kraju.
export function normalizePhoneE164(raw: string, defaultCountry = "48"): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = digitsOnly(trimmed);
  if (!digits) return null;
  if (hasPlus) return digits; // już z kodem kraju (E.164 bez plusa)
  // Bez plusa: polski numer 9-cyfrowy → dodaj kod kraju.
  if (digits.length === 9) return `${defaultCountry}${digits}`;
  return digits;
}

export function hashPhone(raw: string, defaultCountry = "48"): string | null {
  const e164 = normalizePhoneE164(raw, defaultCountry);
  if (!e164) return null;
  return sha256(e164);
}

// Hash imienia (trim + lowercase, tylko pierwszy człon).
export function hashFirstName(name: string): string | null {
  const first = (name || "").trim().toLowerCase().split(/\s+/)[0];
  if (!first) return null;
  return sha256(first);
}

// §9c. Gdy brak cookie _fbc, a w URL jest fbclid — zbuduj _fbc w formacie Meta:
//   fb.1.<timestamp_ms>.<fbclid>
export function deriveFbc(fbclid: string | null | undefined, ts = Date.now()): string | null {
  if (!fbclid) return null;
  return `fb.1.${ts}.${fbclid}`;
}

// Dane wejściowe do zbudowania user_data zdarzenia CAPI.
export type CapiUserInput = {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  fbp?: string | null; // cookie _fbp (przekazane z przeglądarki)
  fbc?: string | null; // cookie _fbc (lub wyprowadzone z fbclid)
  clientIp?: string | null;
  userAgent?: string | null;
};

// Buduje user_data zgodne z Meta (hashowane PII + cookies + ip + ua).
export function buildUserData(input: CapiUserInput): Record<string, unknown> {
  const ud: Record<string, unknown> = {};
  const em = input.email ? hashEmail(input.email) : null;
  const ph = input.phone ? hashPhone(input.phone) : null;
  const fn = input.firstName ? hashFirstName(input.firstName) : null;
  if (em) ud.em = [em];
  if (ph) ud.ph = [ph];
  if (fn) ud.fn = [fn];
  if (input.fbp) ud.fbp = input.fbp;
  if (input.fbc) ud.fbc = input.fbc;
  if (input.clientIp) ud.client_ip_address = input.clientIp;
  if (input.userAgent) ud.client_user_agent = input.userAgent;
  return ud;
}

export type CapiEventResult = { ok: boolean; status?: number; error?: string };

// §9c. Wyślij zdarzenie „Lead” do Conversions API. Fire-and-forget — wywołujący
// NIGDY nie blokuje odpowiedzi do wypełniającego. Zwraca wynik do zalogowania
// (żeby cisza w Events Managerze była diagnozowalna, a nie zgadywana).
export async function sendCapiLead(params: {
  config: MetaConfig;
  eventId: string; // ten sam co Pixel (id sesji) → deduplikacja
  eventSourceUrl?: string | null;
  userData: Record<string, unknown>;
  customData?: Record<string, unknown>;
}): Promise<CapiEventResult> {
  const { config, eventId, eventSourceUrl, userData, customData } = params;
  if (!config.pixelId || !config.capiToken) {
    return { ok: false, error: "brak pixel_id lub tokenu" };
  }
  const body: Record<string, unknown> = {
    data: [
      {
        event_name: "Lead",
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "website",
        ...(eventSourceUrl ? { event_source_url: eventSourceUrl } : {}),
        user_data: userData,
        ...(customData ? { custom_data: customData } : {}),
      },
    ],
    ...(config.testEventCode ? { test_event_code: config.testEventCode } : {}),
  };

  try {
    const url = `https://graph.facebook.com/v19.0/${config.pixelId}/events?access_token=${encodeURIComponent(
      config.capiToken
    )}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, status: res.status, error: detail.slice(0, 300) };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "network error" };
  }
}
