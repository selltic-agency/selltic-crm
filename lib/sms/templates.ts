// lib/sms/templates.ts — podstawianie zmiennych w treści SMS. CZYSTY moduł
// (współdzielony klient/serwer): sam render, bez dostępu do bazy. Wartości
// zmiennych buduje warstwa serwisu z konkretnego rekordu.
//
// Dwie strategie (spójna, jawna obsługa braków):
//   • strict   — wysyłki MANUALNE: brakująca zmienna BLOKUJE wysyłkę (zwracana
//     w `missing`). Nigdy nie renderujemy dosłownych nawiasów w SMS-ie.
//   • graceful — automaty formularzy: brakująca zmienna → pusty ciąg, a artefakty
//     („Cześć ,") są sprzątane (spacje przed interpunkcją, wielokrotne spacje).

export type RenderMode = "strict" | "graceful";

export type RenderResult = {
  text: string;
  missing: string[]; // klucze zmiennych użytych w szablonie, których zabrakło
};

// Zmienne dostępne w pickerze/preview. `sample` do podglądu na sztucznych danych.
export type SmsVariable = { key: string; label: string; sample: string };

export const SMS_VARIABLES: SmsVariable[] = [
  { key: "first_name", label: "Imię", sample: "Anna" },
  { key: "company", label: "Firma", sample: "Kwiaciarnia Róża" },
  { key: "meeting_date", label: "Data spotkania", sample: "24 lipca" },
  { key: "meeting_time", label: "Godzina spotkania", sample: "14:00" },
  { key: "owner_name", label: "Opiekun", sample: "Dominik" },
  { key: "form_name", label: "Nazwa formularza", sample: "Wycena" },
];

export const SMS_SAMPLE_VALUES: Record<string, string> = Object.fromEntries(
  SMS_VARIABLES.map((v) => [v.key, v.sample])
);

const PLACEHOLDER_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

// Sprząta artefakty po pustych zmiennych: spacje przed interpunkcją i zdublowane
// spacje. „Cześć {{first_name}}," z pustym imieniem → „Cześć ," → „Cześć,".
function tidy(text: string): string {
  return text
    .replace(/[ \t]+([,.!?;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// Renderuje szablon. Zwraca tekst i listę brakujących zmiennych.
export function renderSmsTemplate(
  template: string,
  values: Record<string, string>,
  mode: RenderMode = "graceful"
): RenderResult {
  const missing = new Set<string>();
  const substituted = (template || "").replace(PLACEHOLDER_RE, (_m, rawKey: string) => {
    const key = rawKey.toLowerCase();
    const val = values[key];
    if (val == null || val === "") {
      missing.add(key);
      return ""; // nigdy nie zostawiamy dosłownych nawiasów
    }
    return val;
  });
  const text = mode === "graceful" ? tidy(substituted) : substituted.trim();
  return { text, missing: [...missing] };
}

// Lista kluczy zmiennych użytych w szablonie (do podpowiedzi/walidacji).
export function usedSmsVariables(template: string): string[] {
  const out = new Set<string>();
  for (const m of (template || "").matchAll(PLACEHOLDER_RE)) out.add(m[1].toLowerCase());
  return [...out];
}
