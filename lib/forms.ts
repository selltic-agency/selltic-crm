// lib/forms.ts — typy schematu formularza, stałe routingu i helpery kreatora.
import { DEFAULT_PHONE_PREFIX, phoneLocalError, splitPhone } from "@/lib/phone";
import { NEXT, SUBMIT, resolveNextAction, type NextAction } from "./formsRouting";

// Typy pól wejściowych (mogą występować wielokrotnie w jednym kroku).
export type FieldType =
  | "short_text"
  | "long_text"
  | "email"
  | "phone"
  | "single_choice"
  | "multi_choice";

export type StepType =
  | "welcome"
  | "question" // kontener wielu pól (nowy model — item 6)
  | "short_text"
  | "long_text"
  | "email"
  | "phone"
  | "single_choice"
  | "multi_choice"
  | "statement"
  | "end";

const FIELD_TYPE_SET = new Set<string>([
  "short_text",
  "long_text",
  "email",
  "phone",
  "single_choice",
  "multi_choice",
]);

// Czy dany typ (string) jest typem pola wejściowego.
export function isInputType(type: string): type is FieldType {
  return FIELD_TYPE_SET.has(type);
}

// Cele routingu: __next__ (liniowo), __submit__ (wyślij) lub id kroku.
// Zdefiniowane w leaf-module lib/formsRouting.ts (bez zależności — testowalne
// bezpośrednio przez node). Re-eksport zachowuje istniejące importy z @/lib/forms.
export { NEXT, SUBMIT, resolveNextAction };
export type { NextAction };

export type StepOption = {
  id: string;
  label: string;
  description?: string; // podtytuł opcji (druga linia w karcie wyboru)
  icon?: string; // emoji lub krótki znak wyświetlany na karcie opcji
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

// Pojedyncze pole wejściowe (item 6 — krok może zawierać ich wiele).
// Odpowiedzi w formularzu są kluczowane po `id` pola. Dla starych, jedno-
// polowych kroków syntetyzujemy pole o `id === step.id` (patrz stepFields),
// dzięki czemu istniejące, opublikowane formularze działają bez migracji.
export type FormField = {
  id: string;
  type: FieldType;
  question: string; // etykieta pola
  description?: string;
  placeholder?: string;
  required?: boolean;
  validation?: FieldValidation;
  phonePrefix?: string; // domyślny prefiks kraju dla pola „phone”
  options?: StepOption[];
  map?: "name" | "email" | "phone"; // LEGACY: proste mapowanie odpowiedzi → kontakt (Faza 5)
  // §7b: jawne, konfigurowalne mapowanie pola → właściwość CRM (wbudowana lub
  // własna z property_defs). Zastępuje heurystykę. Snapshotowane wraz ze
  // schematem, więc usunięcie właściwości nie psuje istniejących formularzy.
  mapping?: FieldMapping;
};

// §7b. Mapowanie pola formularza na właściwość leadu/kontaktu.
export type FieldMapping = {
  // Klucz właściwości: wbudowanej (name|email|phone|company|value) albo własnej
  // (klucz z property_defs).
  property: string;
  target: "builtin" | "custom";
  // Dla pól wyboru mapowanych na listę (select/multi_select): mapowanie
  // opcja-po-opcji (etykieta opcji formularza → klucz opcji właściwości).
  optionMap?: Record<string, string>;
};

// §7b. Wbudowane właściwości leadu, na które można mapować pola.
export type BuiltinLeadProperty = {
  key: "name" | "email" | "phone" | "company" | "value";
  label: string;
  type: "text" | "email" | "phone" | "number";
};

export const BUILTIN_LEAD_PROPERTIES: BuiltinLeadProperty[] = [
  { key: "name", label: "Imię / nazwa", type: "text" },
  { key: "email", label: "E-mail", type: "email" },
  { key: "phone", label: "Telefon", type: "phone" },
  { key: "company", label: "Firma", type: "text" },
  { key: "value", label: "Wartość (zł)", type: "number" },
];

export type Step = {
  id: string;
  type: StepType;
  question: string;
  description?: string;
  image?: string;
  next: string; // domyślny cel (NEXT | SUBMIT | stepId)
  // Nowy model (item 6): kroki typu „question” trzymają uporządkowaną listę pól.
  fields?: FormField[];
  // ── Pola LEGACY (kroki jedno-polowe sprzed item 6). Zachowane dla zgodności
  //    wstecznej — normalizowane przez stepFields(). Nowe kroki używają fields[].
  options?: StepOption[];
  placeholder?: string;
  required?: boolean;
  validation?: FieldValidation;
  phonePrefix?: string; // domyślny prefiks kraju dla kroku „phone” (np. "+48")
  cta?: string; // etykieta przycisku (welcome)
  map?: "name" | "email" | "phone"; // mapowanie odpowiedzi → kontakt (Faza 5)
};

export type FormLayout = "center" | "left" | "split";

// Styl kontenera formularza: „card” = wyśrodkowana karta z cieniem (jak w
// referencyjnym, brandowanym formularzu), „full” = treść na pełnym tle.
export type FormSurface = "card" | "full";
// Styl opcji wyboru: „list” = lista z literowym skrótem (A/B/C),
// „cards” = duże karty z ikoną + podtytułem (brandowany wygląd).
export type OptionStyle = "list" | "cards";
// Styl paska postępu na górze formularza.
export type ProgressStyle = "bar" | "dots" | "none";

export type FormTheme = {
  font: string;
  primary: string;
  bg: string; // tło strony (za kartą)
  text: string;
  layout: FormLayout;
  // ── Rozszerzenia wyglądu (redesign — brandowany, realistyczny formularz).
  //    Wszystkie opcjonalne: istniejące, opublikowane formularze renderują się
  //    bez zmian (fallbacki w rendererze).
  cardBg?: string; // tło karty formularza (gdy surface = "card")
  bgImage?: string; // własne tło formularza (URL lub wgrany plik) — pod kartą / na całą stronę
  surface?: FormSurface; // "card" (domyślnie dla nowych) | "full"
  optionStyle?: OptionStyle; // "list" (domyślnie) | "cards"
  progress?: ProgressStyle; // "bar" (domyślnie) | "dots" | "none"
  radius?: number; // promień zaokrągleń kart/przycisków (px)
  showStepNumber?: boolean; // etykieta „KROK X” nad pytaniem
  // Podpowiedź przy pytaniach wyboru (np. „Wybierz jedną opcję”). Opcjonalna —
  // stare formularze bez tej flagi jej nie pokazują (fallback w rendererze).
  showChoiceHint?: boolean;
};

// Marka formularza — nagłówek z awatarem/logo, nazwą i podtytułem (jak w
// referencyjnym formularzu „Liam · uczyangielskiego.pl”). Wszystko opcjonalne.
export type FormBranding = {
  logo?: string; // URL awatara/logo (okrągły, w nagłówku)
  name?: string; // nazwa marki, np. „Liam · uczyangielskiego.pl”
  tagline?: string; // krótki podtytuł pod nazwą
  showHeader?: boolean; // pokaż nagłówek marki na każdym kroku
  showAvatarOnSteps?: boolean; // pokaż awatar obok pytania (jak w referencji)
  // ── Dyskretna stopka (prawy dolny róg publicznej strony). Domyślnie logo
  //    formularza + własny podtytuł zamiast brandingu Selltic. Wszystko
  //    opcjonalne i w pełni sterowalne przez właściciela formularza (item 4).
  showFooter?: boolean; // pokaż dyskretną stopkę marki (domyślnie tak)
  footerText?: string; // tekst/podtytuł w stopce (np. „Bezpieczny formularz")
  footerLink?: string; // opcjonalny odnośnik pod stopką (https://…)
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
  // §7a. Szablon domyślnego tytułu leadu, np. „{{field:<id>}} — {{form:title}}”.
  // Pusty → zachowanie domyślne (imię/nazwa z ekstrakcji). Snapshotowany ze schematem.
  defaultLeadTitle?: string;
  // Predefiniowane właściwości formularza — stałe wartości ustawiane ręcznie
  // przez zespół (np. „Źródło = Kampania FB"). UKRYTE dla klienta (nigdy nie
  // renderowane w formularzu), przypisywane do każdego leadu z tego formularza.
  teamProps?: TeamProperty[];
};

// Predefiniowana właściwość formularza (item — właściwości zespołu). Stała
// wartość mapowana na wbudowaną właściwość leadu lub własną z property_defs.
export type TeamProperty = {
  id: string;
  target: "builtin" | "custom";
  property: string; // company | value | klucz z property_defs
  value: string; // stała wartość (parsowana wg typu przy tworzeniu leadu)
};

export type FormSchema = {
  title: string;
  theme: FormTheme;
  branding?: FormBranding; // nagłówek marki (opcjonalny)
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

export function isTextInput(type: string): boolean {
  return type === "short_text" || type === "long_text" || type === "email";
}

// ── Normalizacja kroków → pola (item 6) ───────────────────────────────────
// Zwraca listę pól kroku. Nowe kroki mają `fields[]`. Stare, jedno-polowe kroki
// (typ = typ pola, bez `fields`) są syntetyzowane w POJEDYNCZE pole o
// `id === step.id`, więc odpowiedzi i ekstrakcja działają jak dawniej.
export function stepFields(step: Step): FormField[] {
  if (step.fields && step.fields.length) return step.fields;
  if (isInputType(step.type)) {
    return [
      {
        id: step.id,
        type: step.type as FieldType,
        question: step.question,
        description: step.description,
        placeholder: step.placeholder,
        required: step.required,
        validation: step.validation,
        phonePrefix: step.phonePrefix,
        options: step.options,
        map: step.map,
      },
    ];
  }
  return [];
}

// Czy krok zbiera odpowiedzi (kontener pól lub stary krok jedno-polowy).
export function isInputStep(step: Step): boolean {
  return step.type === "question" || isInputType(step.type);
}

// Czy krok jest już kontenerem z jawną listą pól (nowy model).
export function isContainerStep(step: Step): boolean {
  return step.type === "question" || (!!step.fields && step.fields.length > 0);
}

// Pole rozgałęziające krok — pierwsze pole „single_choice”. Jego wybór (opcja
// → next) steruje routingiem kroku (item 7 — rozgałęzienia warunkowe).
export function branchingField(step: Step): FormField | undefined {
  return stepFields(step).find((f) => f.type === "single_choice");
}

// Walidacja spójności kroku w edytorze (item 7 — walidacja inline). Zwraca
// listę problemów blokujących sensowną publikację (pusty tekst, wybór bez opcji).
export function stepIssues(step: Step): string[] {
  const issues: string[] = [];
  if (isInputStep(step)) {
    const fields = stepFields(step);
    if (fields.length === 0) {
      issues.push("Krok nie ma żadnych pól.");
      return issues;
    }
    for (const f of fields) {
      if (!f.question.trim()) issues.push("Pole bez treści pytania.");
      if (isChoice(f.type)) {
        const opts = f.options ?? [];
        if (opts.length < 1) issues.push("Pole wyboru bez żadnej opcji.");
        else if (opts.some((o) => !o.label.trim())) issues.push("Pusta etykieta opcji.");
      }
    }
  } else if (!step.question.trim()) {
    issues.push("Brak treści nagłówka.");
  }
  return issues;
}

// Konwersja starego, jedno-polowego kroku na kontener `question` z jednym
// polem — używane w edytorze, gdy dodajemy drugie pole do starego kroku.
export function toContainerStep(step: Step): Step {
  if (isContainerStep(step)) {
    return { ...step, type: "question", fields: stepFields(step) };
  }
  if (isInputType(step.type)) {
    const field = stepFields(step)[0];
    return {
      id: step.id,
      type: "question",
      question: "",
      description: step.description,
      image: step.image,
      next: step.next,
      fields: [field],
    };
  }
  return step;
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

// Walidacja wartości pojedynczego pola. Zwraca komunikat błędu lub null gdy OK.
export function validateFieldValue(field: FormField, raw: string): string | null {
  const value = (raw ?? "").trim();

  if (field.required && !value) return "To pole jest wymagane.";
  // Puste, ale nieobowiązkowe — brak dalszej walidacji.
  if (!value) return null;

  // Wbudowany format e-mail dla typu „email”.
  if (field.type === "email" && !EMAIL_RE.test(value)) {
    return field.validation?.customMessage || "Podaj poprawny adres e-mail.";
  }

  // Walidacja telefonu. Dla Polski (+48) egzekwuje 9 cyfr i poprawny prefiks
  // operatora; dla innych krajów pozostaje łagodna reguła (patrz lib/phone.ts).
  if (field.type === "phone") {
    const { prefix, local } = splitPhone(value, field.phonePrefix || DEFAULT_PHONE_PREFIX);
    const msg = phoneLocalError(prefix, local);
    if (msg) return field.validation?.customMessage || msg;
    return null;
  }

  const v = field.validation;
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
  // Sans-serif (nowoczesne, uniwersalne)
  "Inter",
  "DM Sans",
  "Manrope",
  "Poppins",
  "Montserrat",
  "Roboto",
  "Open Sans",
  "Nunito",
  "Work Sans",
  "Raleway",
  "Rubik",
  "Outfit",
  "Plus Jakarta Sans",
  "Space Grotesk",
  "Lexend",
  "Figtree",
  // Serif (elegancki, redakcyjny charakter)
  "Playfair Display",
  "Lora",
  "Merriweather",
  "Source Serif 4",
] as const;

const GOOGLE_FONT_SPEC: Record<string, string> = {
  Inter: "Inter:wght@400;500;600;700",
  "DM Sans": "DM+Sans:wght@400;500;700",
  Manrope: "Manrope:wght@400;500;600;700;800",
  Poppins: "Poppins:wght@400;500;600;700",
  Montserrat: "Montserrat:wght@400;500;600;700",
  Roboto: "Roboto:wght@400;500;700",
  "Open Sans": "Open+Sans:wght@400;500;600;700",
  Nunito: "Nunito:wght@400;500;600;700;800",
  "Work Sans": "Work+Sans:wght@400;500;600;700",
  Raleway: "Raleway:wght@400;500;600;700",
  Rubik: "Rubik:wght@400;500;600;700",
  Outfit: "Outfit:wght@400;500;600;700",
  "Plus Jakarta Sans": "Plus+Jakarta+Sans:wght@400;500;600;700;800",
  "Space Grotesk": "Space+Grotesk:wght@400;500;700",
  Lexend: "Lexend:wght@400;500;600;700",
  Figtree: "Figtree:wght@400;500;600;700",
  "Playfair Display": "Playfair+Display:wght@400;600;700",
  Lora: "Lora:wght@400;500;600;700",
  Merriweather: "Merriweather:wght@400;700",
  "Source Serif 4": "Source+Serif+4:wght@400;500;600;700",
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

// Fabryka pojedynczego pola (item 6).
export function blankField(type: FieldType): FormField {
  const base: FormField = { id: uid(), type, question: "" };
  switch (type) {
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
          { id: uid(), label: "Opcja A", icon: "✨", next: NEXT },
          { id: uid(), label: "Opcja B", icon: "🚀", next: NEXT },
        ],
      };
    case "multi_choice":
      return {
        ...base,
        question: "Wybierz jedną lub więcej",
        options: [
          { id: uid(), label: "Opcja A", icon: "✨", next: NEXT },
          { id: uid(), label: "Opcja B", icon: "🚀", next: NEXT },
        ],
      };
  }
}

// Fabryka kroku-kontenera (item 6) z jednym polem danego typu.
export function blankFieldStep(fieldType: FieldType): Step {
  return { id: uid(), type: "question", question: "", next: NEXT, fields: [blankField(fieldType)] };
}

export function blankStep(type: StepType): Step {
  const base: Step = { id: uid(), type, question: "", next: NEXT };
  switch (type) {
    case "welcome":
      return { ...base, question: "Witaj 👋", description: "Wypełnij krótki formularz.", cta: "Zaczynamy" };
    case "statement":
      return { ...base, question: "Ważna informacja", description: "Treść komunikatu." };
    case "end":
      return { ...base, question: "Dziękujemy! 🎉", description: "Odezwiemy się wkrótce.", next: SUBMIT };
    case "question":
      return blankFieldStep("short_text");
    default:
      // Typy pól tworzą krok-kontener z jednym polem tego typu.
      return blankFieldStep(type as FieldType);
  }
}

export function blankForm(title = "Nowy formularz"): FormSchema {
  return {
    title,
    theme: {
      font: "Inter",
      primary: "#6C5CE7",
      bg: "#F4F1EC",
      text: "#1A1D26",
      layout: "center",
      // Nowe formularze startują z brandowanym, „realistycznym” wyglądem.
      cardBg: "#FFFFFF",
      surface: "card",
      optionStyle: "cards",
      progress: "bar",
      radius: 16,
      showStepNumber: true,
      showChoiceHint: true,
    },
    branding: {
      showHeader: true,
      showAvatarOnSteps: false,
    },
    steps: [
      { ...blankStep("welcome"), next: NEXT },
      { ...blankStep("end") },
    ],
  };
}

// ── Domyślne / fallback wartości wyglądu (pojedyncze źródło prawdy dla
//    renderera i edytora). Stare formularze bez tych pól dostają neutralne,
//    zgodne wstecznie wartości; nowe formularze mają je zapisane wprost.
export function themeSurface(t: FormTheme): FormSurface {
  return t.surface ?? "full";
}
export function themeOptionStyle(t: FormTheme): OptionStyle {
  return t.optionStyle ?? "list";
}
export function themeProgress(t: FormTheme): ProgressStyle {
  return t.progress ?? "bar";
}
export function themeRadius(t: FormTheme): number {
  return t.radius ?? 12;
}
export function themeCardBg(t: FormTheme): string {
  return t.cardBg || t.bg || "#FFFFFF";
}
// Podpowiedź przy pytaniach wyboru — domyślnie ukryta (zgodność wsteczna ze
// starymi formularzami, które jej nie miały). Nowe formularze włączają ją w blankForm.
export function themeChoiceHint(t: FormTheme): boolean {
  return t.showChoiceHint ?? false;
}

// Tekst podpowiedzi zależny od typu pola wyboru.
export function choiceHintText(type: FieldType | StepType): string {
  return type === "multi_choice"
    ? "Możesz wybrać kilka opcji"
    : "Wybierz jedną opcję";
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
