// lib/leadTitle.ts — §7a. Rozwiązywanie szablonu domyślnego tytułu leadu.
// Czysty moduł (tylko importy typów) — testowalny bez zależności runtime.
//
// Placeholdery:
//   {{field:<fieldId>}}  → odpowiedź z danego pola formularza
//   {{form:title}}       → tytuł formularza
//   {{form:slug}}        → slug formularza
//
// Zasada §7a: nierozwiązany placeholder (pominięte pytanie, usunięte pole)
// degraduje się łagodnie — NIGDY nie renderujemy surowego „{{...}}”, a pusty
// wynik zawsze zastępujemy sensownym fallbackiem.
import type { FormField } from "./forms";

export type LeadTitleContext = {
  fields: FormField[]; // spłaszczona lista pól (ze wszystkich kroków)
  answers: Record<string, unknown>;
  formTitle?: string | null;
  formSlug?: string | null;
  fallback?: string; // gdy wynik pusty (domyślnie "Nowy lead")
};

const TOKEN_RE = /\{\{\s*([a-zA-Z]+):([^}]+?)\s*\}\}/g;

// Zwraca wartość odpowiedzi jako czytelny tekst (tablice → przecinki).
function answerText(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean).join(", ");
  return String(value).trim();
}

// Rozwiązuje szablon. Zwraca gotowy tytuł (nigdy pusty, nigdy z surowym tokenem).
export function resolveLeadTitle(template: string, ctx: LeadTitleContext): string {
  const fallback = (ctx.fallback || "Nowy lead").trim() || "Nowy lead";
  const tpl = (template || "").trim();
  if (!tpl) return fallback;

  const byId = new Map(ctx.fields.map((f) => [f.id, f]));

  const rendered = tpl.replace(TOKEN_RE, (_m, kind: string, ref: string) => {
    const key = ref.trim();
    if (kind === "field") {
      const field = byId.get(key);
      if (!field) return ""; // usunięte pole → puste, bez surowego tokena
      return answerText(ctx.answers[key]);
    }
    if (kind === "form") {
      if (key === "title") return (ctx.formTitle || "").trim();
      if (key === "slug") return (ctx.formSlug || "").trim();
      return "";
    }
    return ""; // nieznany token → puste
  });

  // Sprzątanie po pustych podstawieniach: osierocone separatory („ — ”, „ - ”,
  // wiodące/zamykające myślniki), zredukowane spacje.
  const cleaned = rendered
    .replace(/\s*[—–-]\s*[—–-]\s*/g, " — ") // podwójne separatory
    .replace(/^\s*[—–|:,-]+\s*/, "")
    .replace(/\s*[—–|:,-]+\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return cleaned || fallback;
}

// §7a. Lista dostępnych tokenów do UI (picker/lista podpowiedzi).
export type LeadTitleToken = { token: string; label: string };

export function leadTitleTokens(fields: FormField[]): LeadTitleToken[] {
  const fieldTokens: LeadTitleToken[] = fields
    .filter((f) => f.question?.trim())
    .map((f) => ({ token: `{{field:${f.id}}}`, label: f.question.trim() }));
  return [
    { token: "{{form:title}}", label: "Tytuł formularza" },
    { token: "{{form:slug}}", label: "Slug formularza" },
    ...fieldTokens,
  ];
}
