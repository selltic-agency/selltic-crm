// lib/forms.ts — typy schematu formularza, stałe routingu i helpery kreatora.

export type StepType =
  | "welcome"
  | "short_text"
  | "long_text"
  | "email"
  | "single_choice"
  | "multi_choice"
  | "statement"
  | "end";

// Cele routingu: __next__ (liniowo), __submit__ (wyślij) lub id kroku.
export const NEXT = "__next__";
export const SUBMIT = "__submit__";

export type StepOption = {
  id: string;
  label: string;
  next: string; // NEXT | SUBMIT | stepId
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

export type FormSchema = {
  title: string;
  theme: FormTheme;
  steps: Step[];
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
