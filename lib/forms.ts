// lib/forms.ts — typy schematu formularza, stałe routingu i helpery kreatora.
import { DEFAULT_PHONE_PREFIX, phoneLocalError, splitPhone } from "@/lib/phone";
import { NEXT, SUBMIT, resolveNextAction, type NextAction } from "./formsRouting";

export type StepType =
  | "welcome"
  | "short_text"
  | "long_text"
  | "email"
  | "phone"
  | "single_choice"
  | "multi_choice"
  | "statement"
  | "end";

// Cele routingu: __next__ (liniowo), __submit__ (wyślij) lub id kroku.
// Zdefiniowane w leaf-module lib/formsRouting.ts (bez zależności — testowalne
// bezpośrednio przez node). Re-eksport zachowuje istniejące importy z @/lib/forms.
export { NEXT, SUBMIT, resolveNextAction };
export type { NextAction };

export type StepOption = {
  id: string;
  label: string;
  next: string; // NEXT | SUBMIT | stepId
};

// Reguły walidacji pola (Faza 8.1). Wszystkie opcjonalne.
export type FieldValidation = {
  pattern?: string; // regex jako string, np. polski telefon
  minLength?: number;
  maxLength?: number;
  min?: number; // dla pól liczbowych (tekst)
  max?: number;
  customMessage?: string; // komunikat przy niepowodzeniu
};

export type Step = {
  id: string;
  type: StepType;
  question: string;
  description?: string;
  image?: string;
  next: string; // domyślny cel (NEXT | SUBMIT | stepId)
  options?: StepOption[];
  placeholder?: string;
  required?: boolean;
  validation?: FieldValidation;
  phonePrefix?: string; // domyślny prefiks kraju dla kroku „phone” (np. "+48")
  cta?: string; // etykieta przycisku (welcome)
  map?: "name" | "email" | "phone"; // mapowanie odpowiedzi → kontakt (Faza 5)
};

export type FormLayout = "center" | "left" | "split";

export type FormTheme = {
  font: string;
  primary: string;
  bg: string;
  text: string;
  layout: FormLayout;
};

// Treść automatycznego maila „dziękujemy” (Faza: e-mail po zgłoszeniu).
// Edytowalna w kreatorze. Placeholdery: {{extra_link}}, {{name}}.
export type ThankYouEmail = {
  enabled: boolean;
  subject: string;
  html: string;
};

// Ustawienia formularza (poza motywem i krokami) — przekierowanie po wysłaniu
// oraz automatyczny mail z podziękowaniem.
export type FormSettings = {
  redirectUrl?: string; // pusty = domyślny ekran „dziękujemy”
  extraLink?: string; // np. link do konsultacji / VSL, wstawiany przez {{extra_link}}
  thankYouEmail?: ThankYouEmail;
};

export type FormSchema = {
  title: string;
  theme: FormTheme;
  steps: Step[];
  settings?: FormSettings;
};

export type FormStatus = "draft" | "published";

export type FormRow = {
  id: string;
  owner: string;
  title: string;
  slug: string | null;
  schema: FormSchema;
  published: FormSchema | null;
  status: FormStatus;
  created_at: string;
  updated_at: string;
};

// ── Metadane typów kroków (etykiety dla UI) ───────────────────────────────
export const STEP_TYPES: { type: StepType; label: string }[] = [
  { type: "welcome", label: "Powitanie" },
  { type: "short_text", label: "Krótki tekst" },
  { type: "long_text", label: "Długi tekst" },
  { type: "email", label: "E-mail" },
  { type: "phone", label: "Telefon" },
  { type: "single_choice", label: "Wybór jednokrotny" },
  { type: "multi_choice", label: "Wybór wielokrotny" },
  { type: "statement", label: "Komunikat" },
  { type: "end", label: "Zakończenie" },
];

export function stepTypeLabel(type: StepType): string {
  return STEP_TYPES.find((s) => s.type === type)?.label ?? type;
}

export function isChoice(type: StepType): boolean {
  return type === "single_choice" || type === "multi_choice";
}

export function isTextInput(type: StepType): boolean {
  return type === "short_text" || type === "long_text" || type === "email";
}

// ── Walidacja pól (Faza 8.1) ──────────────────────────────────────────────
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Gotowe presety walidacji. `key === "none"` i `key === "custom"` to tryby UI
// (bez własnego wzorca). Pozostałe niosą gotowy `pattern` + `message`.
export type ValidationPreset = {
  key: string;
  label: string;
  pattern?: string;
  message?: string;
};

export const VALIDATION_PRESETS: ValidationPreset[] = [
  { key: "none", label: "Brak" },
  {
    key: "email",
    label: "E-mail",
    pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
    message: "Podaj poprawny adres e-mail.",
  },
  {
    key: "phone_pl",
    label: "Telefon (PL)",
    pattern: "^(\\+48)?\\s?\\d{3}[\\s-]?\\d{3}[\\s-]?\\d{3}$",
    message: "Podaj poprawny numer telefonu.",
  },
  {
    key: "nip",
    label: "NIP",
    pattern: "^\\d{10}$",
    message: "NIP musi mieć 10 cyfr.",
  },
  {
    key: "postal_pl",
    label: "Kod pocztowy (PL)",
    pattern: "^\\d{2}-\\d{3}$",
    message: "Podaj kod w formacie 00-000.",
  },
  { key: "custom", label: "Własne wyrażenie" },
];

// Wskazuje, który preset odpowiada aktualnemu wzorcowi (do UI edytora).
export function detectPreset(v?: FieldValidation): string {
  if (!v?.pattern) return "none";
  const found = VALIDATION_PRESETS.find((p) => p.pattern && p.pattern === v.pattern);
  return found ? found.key : "custom";
}

// Czy obiekt walidacji niesie jakiekolwiek reguły (do czyszczenia pustych).
export function hasValidationRules(v?: FieldValidation): boolean {
  if (!v) return false;
  return (
    !!v.pattern ||
    v.minLength != null ||
    v.maxLength != null ||
    v.min != null ||
    v.max != null
  );
}

// Główna walidacja wartości kroku. Zwraca komunikat błędu lub null gdy OK.
export function validateStepValue(step: Step, raw: string): string | null {
  const value = (raw ?? "").trim();

  if (step.required && !value) return "To pole jest wymagane.";
  // Puste, ale nieobowiązkowe — brak dalszej walidacji.
  if (!value) return null;

  // Wbudowany format e-mail dla typu „email”.
  if (step.type === "email" && !EMAIL_RE.test(value)) {
    return step.validation?.customMessage || "Podaj poprawny adres e-mail.";
  }

  // Walidacja telefonu. Dla Polski (+48) egzekwuje 9 cyfr i poprawny prefiks
  // operatora; dla innych krajów pozostaje łagodna reguła (patrz lib/phone.ts).
  if (step.type === "phone") {
    const { prefix, local } = splitPhone(value, step.phonePrefix || DEFAULT_PHONE_PREFIX);
    const msg = phoneLocalError(prefix, local);
    if (msg) return step.validation?.customMessage || msg;
    return null;
  }

  const v = step.validation;
  if (!v) return null;

  if (v.minLength != null && value.length < v.minLength) {
    return v.customMessage || `Minimalna długość: ${v.minLength} znaków.`;
  }
  if (v.maxLength != null && value.length > v.maxLength) {
    return v.customMessage || `Maksymalna długość: ${v.maxLength} znaków.`;
  }
  if (v.min != null && Number(value) < v.min) {
    return v.customMessage || `Wartość minimalna: ${v.min}.`;
  }
  if (v.max != null && Number(value) > v.max) {
    return v.customMessage || `Wartość maksymalna: ${v.max}.`;
  }
  if (v.pattern) {
    try {
      if (!new RegExp(v.pattern).test(value)) {
        return v.customMessage || "Nieprawidłowy format.";
      }
    } catch {
      // Niepoprawny regex w konfiguracji — nie blokuj użytkownika.
    }
  }
  return null;
}

// ── Czcionki (Google Fonts) ───────────────────────────────────────────────
export const FONTS = [
  "Inter",
  "DM Sans",
  "Space Grotesk",
  "Playfair Display",
  "Lora",
] as const;

const GOOGLE_FONT_SPEC: Record<string, string> = {
  Inter: "Inter:wght@400;500;600;700",
  "DM Sans": "DM+Sans:wght@400;500;700",
  "Space Grotesk": "Space+Grotesk:wght@400;500;700",
  "Playfair Display": "Playfair+Display:wght@400;600;700",
  Lora: "Lora:wght@400;500;600;700",
};

export function googleFontHref(font: string): string | null {
  const spec = GOOGLE_FONT_SPEC[font];
  return spec ? `https://fonts.googleapis.com/css2?family=${spec}&display=swap` : null;
}

// ── Fabryki ────────────────────────────────────────────────────────────────
function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function blankStep(type: StepType): Step {
  const base: Step = { id: uid(), type, question: "", next: NEXT };
  switch (type) {
    case "welcome":
      return { ...base, question: "Witaj 👋", description: "Wypełnij krótki formularz.", cta: "Zaczynamy" };
    case "short_text":
      return { ...base, question: "Twoje pytanie", placeholder: "Wpisz odpowiedź…", required: true };
    case "long_text":
      return { ...base, question: "Twoje pytanie", placeholder: "Wpisz odpowiedź…", required: false };
    case "email":
      return { ...base, question: "Jaki jest Twój e-mail?", placeholder: "ty@firma.pl", required: true, map: "email" };
    case "phone":
      return {
        ...base,
        question: "Jaki jest Twój numer telefonu?",
        placeholder: "123 456 789",
        required: true,
        map: "phone",
        phonePrefix: DEFAULT_PHONE_PREFIX,
      };
    case "single_choice":
      return {
        ...base,
        question: "Wybierz opcję",
        options: [
          { id: uid(), label: "Opcja A", next: NEXT },
          { id: uid(), label: "Opcja B", next: NEXT },
        ],
      };
    case "multi_choice":
      return {
        ...base,
        question: "Wybierz jedną lub więcej",
        options: [
          { id: uid(), label: "Opcja A", next: NEXT },
          { id: uid(), label: "Opcja B", next: NEXT },
        ],
      };
    case "statement":
      return { ...base, question: "Ważna informacja", description: "Treść komunikatu." };
    case "end":
      return { ...base, question: "Dziękujemy! 🎉", description: "Odezwiemy się wkrótce.", next: SUBMIT };
  }
}

export function blankForm(title = "Nowy formularz"): FormSchema {
  return {
    title,
    theme: {
      font: "Inter",
      primary: "#6C5CE7",
      bg: "#FFFFFF",
      text: "#1A1D26",
      layout: "center",
    },
    steps: [
      { ...blankStep("welcome"), next: NEXT },
      { ...blankStep("end") },
    ],
  };
}

export function randomSlug(): string {
  return "form-" + Math.random().toString(36).slice(2, 8);
}

export function newStepId(): string {
  return uid();
}

// ── Automatyczny mail „dziękujemy” ────────────────────────────────────────
// Domyślny szablon (dopóki użytkownik go nie zmieni). Zawiera podziękowanie,
// link do strony Selltic oraz placeholder {{extra_link}} na dodatkowy link
// (konsultacja / VSL), konfigurowalny w ustawieniach formularza.
export const DEFAULT_THANK_YOU_SUBJECT = "Dziękujemy za wypełnienie formularza 🙌";

export const DEFAULT_THANK_YOU_HTML = `<p>Cześć {{name}},</p>
<p>dziękujemy za wypełnienie formularza! Wkrótce się z Tobą skontaktujemy.</p>
<p>W międzyczasie zajrzyj na naszą stronę: <a href="https://selltic-agency.pl">selltic-agency.pl</a>.</p>
<p>👉 <a href="{{extra_link}}">Umów bezpłatną konsultację</a></p>
<p>Pozdrawiamy,<br/>Zespół Selltic</p>`;

export function defaultThankYouEmail(): ThankYouEmail {
  return {
    enabled: true,
    subject: DEFAULT_THANK_YOU_SUBJECT,
    html: DEFAULT_THANK_YOU_HTML,
  };
}

// Podstawia placeholdery w treści maila. {{extra_link}} → skonfigurowany URL
// (fallback: strona Selltic), {{name}} → imię/nazwa leada.
export function renderThankYouHtml(
  html: string,
  vars: { extraLink?: string; name?: string }
): string {
  const extra = (vars.extraLink || "").trim() || "https://selltic-agency.pl";
  const name = (vars.name || "").trim() || "";
  return (html || "")
    .replace(/\{\{\s*extra_link\s*\}\}/g, extra)
    .replace(/\{\{\s*name\s*\}\}/g, name);
}
