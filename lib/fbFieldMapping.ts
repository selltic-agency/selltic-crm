// lib/fbFieldMapping.ts — mapowanie odpowiedzi z formularza błyskawicznego
// Facebooka na pola deala. Czysta funkcja (bez I/O) — testowalna, wołana
// z /api/leads/facebook przez lib/server/fbLeads.ts.
//
// Facebook oddaje odpowiedzi jako `field_data`, gdzie `name` to techniczna
// nazwa pola nadana w kreatorze formularza (dla pól standardowych stała:
// `email`, `phone_number`, `full_name`; dla pytań własnych — slug pytania,
// często po polsku). Mapowanie trzymamy per formularz w tabeli
// `fb_lead_forms.field_map`, żeby zmiana formularza w Meta nie wymagała
// deployu.

// Cel mapowania: wbudowane pole deala, właściwość własna albo pominięcie.
export type FbFieldTarget =
  | "name"
  | "first_name"
  | "last_name"
  | "email"
  | "phone"
  | "company"
  | "value"
  | "ignore"
  | `prop:${string}`;

// { "<nazwa pola FB>": "<cel>" }
export type FbFieldMap = Record<string, string>;

// Standardowe nazwy pól Facebooka rozpoznawane bez konfiguracji. Pola własne
// (pytania po polsku) wymagają jawnego mapowania — do tego czasu ich
// odpowiedzi i tak trafiają na oś czasu leada, więc nic nie ginie.
export const DEFAULT_FB_FIELD_MAP: FbFieldMap = {
  full_name: "name",
  first_name: "first_name",
  last_name: "last_name",
  email: "email",
  phone_number: "phone",
  company_name: "company",
  job_title: "ignore",
};

// Wartość pola po normalizacji: jedna odpowiedź (multi-select sklejamy przecinkiem).
export type FbAnswers = Record<string, string>;

// Znormalizowany lead z Facebooka — kształt niezależny od tego, czy przyszedł
// z modułu Make, czy z surowego webhooka Graph API.
export type FbLeadPayload = {
  leadId: string;
  formId: string;
  formName: string | null;
  pageId: string | null;
  adId: string | null;
  adsetId: string | null;
  campaignId: string | null;
  platform: string | null;
  isOrganic: boolean | null;
  createdAt: string | null; // ISO
  answers: FbAnswers;
};

// Surowe `field_data` bywa tablicą (Graph API / surowy webhook) albo płaskim
// obiektem (moduł Make po zmapowaniu). Obsługujemy oba kształty — inaczej
// każda zmiana konfiguracji scenariusza w Make wywracałaby ingest.
export function normalizeFieldData(raw: unknown): FbAnswers {
  const out: FbAnswers = {};
  if (!raw) return out;

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as { name?: unknown; values?: unknown; value?: unknown };
      const name = typeof e.name === "string" ? e.name.trim() : "";
      if (!name) continue;
      let value = "";
      if (Array.isArray(e.values)) value = e.values.filter((v) => v != null).map(String).join(", ");
      else if (e.value != null) value = String(e.value);
      out[name] = value.trim();
    }
    return out;
  }

  if (typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const name = k.trim();
      if (!name) continue;
      if (v == null) continue;
      out[name] = Array.isArray(v) ? v.map(String).join(", ").trim() : String(v).trim();
    }
  }
  return out;
}

// Pierwsza niepusta wartość z aliasów (payload z Make bywa różnie nazwany
// zależnie od tego, jak scenariusz mapuje pola modułu).
function pick(src: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = src[k];
    if (v == null) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

// Make potrafi przekazać flagę logiczną jako tekst ("true"/"false") — zależnie
// od tego, czy pole przeszło przez mapowanie, czy zostało wpisane wprost.
function parseBool(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const s = raw.trim().toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
  }
  return null;
}

// Czas utworzenia leada po stronie Meta. Facebook podaje `created_time`
// w ISO 8601 albo jako uniksowy timestamp (sekundy) — oba są poprawne.
export function parseFbCreatedTime(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number" || /^\d+$/.test(String(raw))) {
    const secs = Number(raw);
    if (!Number.isFinite(secs) || secs <= 0) return null;
    return new Date(secs * 1000).toISOString();
  }
  const d = new Date(String(raw));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Sprowadza dowolny wariant payloadu (Make / surowy webhook) do jednego
// kształtu. Zwraca null, gdy brakuje identyfikatora leada — bez niego lead
// jest bezużyteczny dla sygnału zwrotnego do Meta.
export function parseFbLeadPayload(raw: Record<string, unknown>): FbLeadPayload | null {
  const leadId = pick(raw, "leadgen_id", "lead_id", "leadId", "id");
  if (!leadId) return null;

  const answers = normalizeFieldData(
    raw.field_data ?? raw.fieldData ?? raw.fields ?? raw.answers ?? null
  );

  return {
    leadId,
    formId: pick(raw, "form_id", "formId") ?? "",
    formName: pick(raw, "form_name", "formName"),
    pageId: pick(raw, "page_id", "pageId"),
    adId: pick(raw, "ad_id", "adId"),
    adsetId: pick(raw, "adset_id", "adsetId", "ad_set_id"),
    campaignId: pick(raw, "campaign_id", "campaignId"),
    platform: pick(raw, "platform"),
    isOrganic: parseBool(raw.is_organic ?? raw.isOrganic),
    createdAt: parseFbCreatedTime(raw.created_time ?? raw.createdTime ?? raw.created_at ?? null),
    answers,
  };
}

export type MappedFbLead = {
  name: string;
  email: string;
  phone: string;
  company: string;
  value: number | null;
  props: Record<string, unknown>;
  // Pola, których mapowanie nie obejmuje — surowo, żeby UI mogło zaproponować
  // domapowanie, a oś czasu i tak pokazała odpowiedź.
  unmapped: FbAnswers;
};

// Nakłada mapowanie na odpowiedzi. Mapowanie własne ma pierwszeństwo nad
// domyślnym (właściciel może przekierować `email` na właściwość, jeśli chce).
export function mapFbAnswers(answers: FbAnswers, fieldMap: FbFieldMap = {}): MappedFbLead {
  const out: MappedFbLead = {
    name: "",
    email: "",
    phone: "",
    company: "",
    value: null,
    props: {},
    unmapped: {},
  };
  let firstName = "";
  let lastName = "";

  for (const [field, rawValue] of Object.entries(answers)) {
    const value = (rawValue ?? "").trim();
    const target = (fieldMap[field] ?? DEFAULT_FB_FIELD_MAP[field] ?? "") as FbFieldTarget | "";

    if (!target) {
      if (value) out.unmapped[field] = value;
      continue;
    }
    if (target === "ignore" || !value) continue;

    if (target.startsWith("prop:")) {
      const key = target.slice(5).trim();
      if (key) out.props[key] = value;
      continue;
    }
    switch (target) {
      case "name":
        if (!out.name) out.name = value;
        break;
      case "first_name":
        firstName = value;
        break;
      case "last_name":
        lastName = value;
        break;
      case "email":
        if (!out.email) out.email = value.toLowerCase();
        break;
      case "phone":
        if (!out.phone) out.phone = value;
        break;
      case "company":
        if (!out.company) out.company = value;
        break;
      case "value": {
        const n = Number(value.replace(/\s/g, "").replace(",", "."));
        if (!Number.isNaN(n)) out.value = n;
        break;
      }
    }
  }

  // Imię i nazwisko w osobnych polach (częste w formularzach FB) → jedno imię
  // i nazwisko leada, ale tylko gdy nie było pola `full_name`.
  if (!out.name) {
    const joined = [firstName, lastName].filter(Boolean).join(" ").trim();
    if (joined) out.name = joined;
  }

  return out;
}

// Czytelna lista „pytanie: odpowiedź” na oś czasu leada. Bierze WSZYSTKIE
// odpowiedzi (także niezmapowane), więc treść zgłoszenia nigdy nie ginie,
// nawet gdy mapowanie jest jeszcze nieskonfigurowane.
export function answersSummary(answers: FbAnswers): string {
  return Object.entries(answers)
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => `${humanizeFieldName(k)}: ${v}`)
    .join("\n");
}

// `jaka_usluga_cie_interesuje?` → „Jaka usluga cie interesuje?”
export function humanizeFieldName(name: string): string {
  const s = name.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return name;
  return s.charAt(0).toUpperCase() + s.slice(1);
}
