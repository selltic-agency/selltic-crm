// lib/server/leadMail.ts — powiadomienie e-mail „nowy lead” (Resend).
// Wyodrębnione z /api/submit, żeby leady z formularzy błyskawicznych
// Facebooka szły tą samą ścieżką i wyglądały tak samo w skrzynce.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient;

export type MailConfig = { apiKey: string; from: string; replyTo?: string };

// Konfiguracja Resend właściciela: ustawienia z UI mają pierwszeństwo,
// zmienne środowiskowe są fallbackiem (spójnie z modułem SMS).
export function mailConfigFrom(settings: {
  resend_api_key?: string | null;
  resend_from?: string | null;
  resend_reply_to?: string | null;
} | null): MailConfig {
  return {
    apiKey: settings?.resend_api_key || process.env.RESEND_API_KEY || "",
    from: settings?.resend_from || process.env.RESEND_FROM || "Selltic <leady@twoja-domena.pl>",
    replyTo: settings?.resend_reply_to || undefined,
  };
}

export async function loadMailConfig(db: Db, owner: string): Promise<MailConfig> {
  const { data } = await db
    .from("app_settings")
    .select("resend_api_key, resend_from, resend_reply_to")
    .eq("owner", owner)
    .maybeSingle();
  return mailConfigFrom(data ?? null);
}

export type NewLeadMail = {
  name: string;
  email: string;
  phone: string;
  returning: boolean;
  // Etykieta źródła w temacie/treści — np. „Facebook Lead Ads”. Brak = lead
  // z formularza na stronie (dotychczasowe brzmienie maila bez zmian).
  sourceLabel?: string;
  // Dodatkowe wiersze „pytanie: odpowiedź” (np. odpowiedzi z formularza FB).
  details?: string;
};

// Wysyła powiadomienie o nowym leadzie. Odporne na błędy — mail jest wtórny
// wobec zapisanego leada i nigdy nie może wywrócić ingestu.
export async function sendNewLeadEmail(mail: MailConfig, to: string, lead: NewLeadMail): Promise<void> {
  if (!mail.apiKey || !to) return;
  const kind = lead.returning ? "Powracający e-mail — nowy lead" : "Nowy lead";
  const heading = lead.sourceLabel ? `${kind} (${lead.sourceLabel})` : kind;
  const origin = lead.sourceLabel
    ? `Nowa szansa sprzedaży z: ${lead.sourceLabel}.`
    : `Nowa szansa sprzedaży z formularza${
        lead.returning ? " (ten e-mail już wcześniej zostawił zgłoszenie)" : ""
      }.`;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${mail.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: mail.from,
        to,
        ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
        subject: `🎯 ${heading}: ${lead.name}`,
        html: `<h2>${heading}</h2>
               <p>${origin}</p>
               <p><b>Imię:</b> ${escapeHtml(lead.name)}</p>
               <p><b>Email:</b> ${escapeHtml(lead.email) || "—"}</p>
               <p><b>Telefon:</b> ${escapeHtml(lead.phone) || "—"}</p>
               ${lead.details ? `<hr /><pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(lead.details)}</pre>` : ""}`,
      }),
    });
  } catch (e) {
    console.error("[sendNewLeadEmail]", e);
  }
}

// Odpowiedzi z formularza trafiają do HTML-a maila — wartości pochodzą od
// osoby wypełniającej, więc muszą być zescapowane.
function escapeHtml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
