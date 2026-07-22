// lib/server/leads.ts — §6/§7. Wspólna ścieżka tworzenia leadu z formularza.
// Używana przez /api/submit (zgłoszenia kompletne) ORAZ przez cron porzuceń
// (§6 — porzucone wypełnienia z e-mailem/telefonem). Ten sam kod = to samo
// mapowanie, ten sam etap startowy, ten sam przydział.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FormSchema, Step } from "@/lib/forms";
import { stepFields } from "@/lib/forms";
import { resolveMappedValues, type MappingWarning, type PropTypeLookup } from "@/lib/leadMapping";
import { resolveLeadTitle } from "@/lib/leadTitle";
import { CONTACT_SOURCE_KEY, ensureContactSourceDef } from "@/lib/contactSource";
import type { PropertyType } from "@/lib/types";

type Db = SupabaseClient;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Heurystyczna ekstrakcja (fallback, gdy brak jawnego mapowania §7b) — zachowuje
// dotychczasowe zachowanie dla starych formularzy.
function extractHeuristic(answers: Record<string, unknown>, steps: Step[]) {
  let email = "", name = "", phone = "";
  for (const step of steps ?? []) {
    for (const field of stepFields(step)) {
      const v = answers[field.id];
      if (v == null || v === "") continue;
      if (field.map === "email" || (field.type === "email" && !email)) email = String(v);
      else if (field.map === "name") name = String(v);
      else if (field.map === "phone") phone = String(v);
    }
  }
  if (!email) for (const v of Object.values(answers)) if (typeof v === "string" && EMAIL_RE.test(v)) { email = v; break; }
  return { email, name, phone };
}

// §6 — czy częściowe odpowiedzi zawierają e-mail lub telefon (warunek utworzenia
// leadu z porzuconego wypełnienia). Sprawdza pola email/phone, jawne mapowania
// oraz heurystycznie dowolną wartość wyglądającą jak e-mail.
export function answersHaveContact(schema: FormSchema, answers: Record<string, unknown>): boolean {
  const steps = (schema?.steps ?? []) as Step[];
  for (const step of steps) {
    for (const f of stepFields(step)) {
      const v = answers[f.id];
      if (v == null || v === "") continue;
      const isEmailOrPhone =
        f.type === "email" ||
        f.type === "phone" ||
        f.map === "email" ||
        f.map === "phone" ||
        f.mapping?.property === "email" ||
        f.mapping?.property === "phone";
      if (isEmailOrPhone) return true;
    }
  }
  for (const v of Object.values(answers)) {
    if (typeof v === "string" && EMAIL_RE.test(v)) return true;
  }
  return false;
}

// Pytanie kroku, na którym stanął gość (do etykiety porzucenia). Bierze treść
// kroku lub pierwszego pola.
export function stepQuestionAt(schema: FormSchema, index: number): string | null {
  const steps = (schema?.steps ?? []) as Step[];
  const step = steps[index];
  if (!step) return null;
  if (step.question?.trim()) return step.question.trim();
  const f = stepFields(step)[0];
  return f?.question?.trim() || null;
}

export async function buildPropTypeLookup(db: Db, owner: string): Promise<PropTypeLookup> {
  const { data } = await db.from("property_defs").select("key, type").eq("owner", owner);
  const map = new Map<string, PropertyType>((data ?? []).map((d) => [d.key as string, d.type as PropertyType]));
  return (key: string) => map.get(key);
}

async function firstStageKey(db: Db, owner: string): Promise<string> {
  const { data } = await db
    .from("pipeline_stages")
    .select("key")
    .eq("owner", owner)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data?.key ?? "new";
}

export type CreateLeadArgs = {
  db: Db;
  owner: string;
  formId: string;
  formSlug: string | null;
  formTitle: string | null;
  schema: FormSchema;
  answers: Record<string, unknown>;
  incomplete: boolean;
  // §6 — dane o kroku porzucenia (do aktywności na osi czasu).
  dropOff?: { step: number; total: number; question?: string | null };
};

export type CreateLeadResult = {
  dealId: string;
  name: string;
  email: string;
  phone: string;
  dealExisted: boolean;
  warnings: MappingWarning[];
};

// Tworzy deal (lead) z odpowiedzi formularza: mapowanie §7b + tytuł §7a +
// aktywność + powiadomienie + flaga duplikatu. Zwraca id i dane kontaktowe.
export async function createLeadFromForm(args: CreateLeadArgs): Promise<CreateLeadResult> {
  const { db, owner, formId, formSlug, formTitle, schema, answers, incomplete, dropOff } = args;
  const steps = (schema?.steps ?? []) as Step[];
  const fields = steps.flatMap((s) => stepFields(s));
  const settings = schema?.settings ?? {};

  const heuristic = extractHeuristic(answers, steps);

  // §7b. Jawne mapowania pól → właściwości (wbudowane + własne).
  const propType = await buildPropTypeLookup(db, owner);
  const mapped = resolveMappedValues(fields, answers, propType);

  const email = mapped.builtin.email || heuristic.email || "";
  const phone = mapped.builtin.phone || heuristic.phone || "";
  const contactName = mapped.builtin.name || heuristic.name || "";

  // §7a. Tytuł leadu z szablonu (fallback: nazwa kontaktu / „Nowy lead”).
  const template = (settings.defaultLeadTitle || "").trim();
  const title = template
    ? resolveLeadTitle(template, {
        fields,
        answers,
        formTitle,
        formSlug,
        fallback: contactName || "Nowy lead",
      })
    : contactName || "Nowy lead";

  const dealExisted = email
    ? !!(await db.from("deals").select("id").eq("owner", owner).eq("email", email).limit(1).maybeSingle()).data
    : false;

  const stage = await firstStageKey(db, owner);

  // Predefiniowane właściwości zespołu (ukryte dla klienta) — stałe wartości
  // doklejane do leadu. Custom → props[key]; wbudowane (company/value) wypełniają
  // tylko, gdy mapowanie pola ich nie dostarczyło (nie nadpisujemy danych klienta).
  const teamProps = (settings.teamProps ?? []) as { target?: string; property?: string; value?: string }[];
  const props: Record<string, unknown> = { ...mapped.props };
  let teamCompany: string | undefined;
  let teamValue: number | undefined;
  for (const tp of teamProps) {
    const val = (tp.value ?? "").trim();
    if (!tp.property || !val) continue;
    if (tp.target === "custom") {
      props[tp.property] = val;
    } else if (tp.property === "company") {
      teamCompany = val;
    } else if (tp.property === "value") {
      const n = Number(val);
      if (!Number.isNaN(n)) teamValue = n;
    }
  }

  // Właściwość „Źródło kontaktu" — deal z formularza dostaje 'formularz'
  // (o ile mapowanie pól nie ustawiło jej jawnie). Dosiew definicji jest
  // idempotentny — patrz lib/contactSource.ts.
  await ensureContactSourceDef(db, owner);
  if (props[CONTACT_SOURCE_KEY] == null || props[CONTACT_SOURCE_KEY] === "") {
    props[CONTACT_SOURCE_KEY] = "formularz";
  }

  const insert: Record<string, unknown> = {
    owner,
    name: title,
    email,
    phone,
    stage,
    source: formSlug ? `form:${formSlug}` : "form",
    form_id: formId,
    incomplete,
    props,
  };
  if (mapped.builtin.company) insert.company = mapped.builtin.company;
  else if (teamCompany) insert.company = teamCompany;
  if (typeof mapped.builtin.value === "number") insert.value = mapped.builtin.value;
  else if (typeof teamValue === "number") insert.value = teamValue;

  const { data: deal, error } = await db.from("deals").insert(insert).select("id").single();
  if (error) throw error;
  const dealId = deal.id as string;

  // Oś czasu: aktywność zgłoszenia lub porzucenia (§6).
  if (incomplete) {
    const pos = dropOff ? `${Math.min(dropOff.step + 1, Math.max(dropOff.total, 1))}/${Math.max(dropOff.total, 1)}` : "?";
    const q = dropOff?.question ? ` — „${dropOff.question}”` : "";
    await db.from("activities").insert({
      owner,
      deal_id: dealId,
      type: "note",
      body: `Rozpoczął formularz „${formTitle || "formularz"}”, porzucił na kroku ${pos}${q}`,
      meta: { formId, incomplete: true },
    });
  } else {
    const summary = fields
      .filter((f) => {
        const v = answers[f.id];
        return v != null && v !== "" && !(Array.isArray(v) && v.length === 0);
      })
      .map((f) => {
        const v = answers[f.id];
        return `${f.question}: ${Array.isArray(v) ? v.join(", ") : v}`;
      })
      .join("\n");
    await db.from("activities").insert({
      owner,
      deal_id: dealId,
      type: "submission",
      body: summary || "Wypełnił formularz",
      meta: { formId },
    });
  }

  // Powiadomienie (dzwonek).
  const kindLabel = incomplete
    ? "Niekompletny lead (porzucony formularz)"
    : dealExisted
    ? "Powracający e-mail — nowy lead"
    : "Nowy lead";
  await db.from("notifications").insert({
    owner,
    deal_id: dealId,
    type: "new_lead",
    body: `${kindLabel}: ${title}`,
  });

  // Flaga duplikatu: telefon pasuje do INNEGO deala.
  if (phone) {
    const { data: matches } = await db
      .from("deals")
      .select("id")
      .eq("owner", owner)
      .eq("phone", phone)
      .neq("id", dealId)
      .limit(1);
    if (matches?.[0]) {
      await db.from("duplicate_flags").insert({
        owner,
        deal_a: dealId,
        deal_b: matches[0].id,
        reason: "phone match, different email",
      });
    }
  }

  return { dealId, name: title, email, phone, dealExisted, warnings: mapped.warnings };
}
