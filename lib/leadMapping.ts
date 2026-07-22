// lib/leadMapping.ts — §7b. Mapowanie pól formularza → właściwości CRM.
// Czysty moduł (tylko importy typów) — testowalny bez zależności runtime.
//
// Zasady §7b:
//  • Tylko typy zgodne (multi_select nie mapuje się na number).
//  • Zgodne, lecz nieidentyczne → koercja przy zapisie; gdy koercja się nie
//    powiedzie: POMIŃ wartość, zostaw surową odpowiedź w zgłoszeniu, ZALOGUJ.
//    Nigdy nie porzucamy zgłoszenia ani nie blokujemy leadu.
//  • Pola wyboru → listy mapują się opcja-po-opcji (optionMap).
//  • Ten sam kod obsługuje zgłoszenia kompletne i porzucone (§6).
import type { FieldType, FormField } from "./forms";
import type { PropertyType } from "./types";

// Typ celu mapowania: właściwości własne (PropertyType) + „phone” dla
// wbudowanej kolumny telefonu (przechowywanej jako tekst).
export type MapTargetType = PropertyType | "phone";

// Wbudowane właściwości leadu i ich typy docelowe.
export const BUILTIN_TARGET_TYPE: Record<string, MapTargetType> = {
  name: "text",
  email: "email",
  phone: "phone",
  company: "text",
  value: "number",
};

// Które typy pól są zgodne z danym typem docelowym właściwości.
const COMPAT: Record<MapTargetType, FieldType[]> = {
  text: ["short_text", "long_text", "email", "phone", "link", "number", "single_choice", "multi_choice", "dropdown", "checkbox", "yes_no"],
  email: ["email", "short_text"],
  phone: ["phone", "short_text"],
  number: ["short_text", "number", "single_choice"],
  date: ["short_text", "single_choice"],
  select: ["single_choice", "short_text", "dropdown"],
  multi_select: ["multi_choice", "single_choice", "dropdown"],
  boolean: ["single_choice", "short_text", "checkbox", "yes_no"],
};

export function isCompatible(fieldType: FieldType, targetType: MapTargetType): boolean {
  return COMPAT[targetType]?.includes(fieldType) ?? false;
}

// Dla edytora: które typy docelowe są zgodne z danym typem pola.
export function compatibleTargetTypes(fieldType: FieldType): MapTargetType[] {
  return (Object.keys(COMPAT) as MapTargetType[]).filter((t) => isCompatible(fieldType, t));
}

// ── Koercja pojedynczej wartości ─────────────────────────────────────────
export type CoerceResult = { ok: true; value: unknown } | { ok: false; reason: string };

function joinText(raw: unknown): string {
  if (raw == null) return "";
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean).join(", ");
  return String(raw).trim();
}

export function coerceValue(
  raw: unknown,
  targetType: MapTargetType,
  optionMap?: Record<string, string>
): CoerceResult {
  switch (targetType) {
    case "text":
    case "email":
    case "phone":
      return { ok: true, value: joinText(raw) };

    case "number": {
      const stripped = joinText(raw).replace(/[^\d.,-]/g, "").replace(",", ".");
      if (!stripped || !/\d/.test(stripped)) return { ok: false, reason: "nie jest liczbą" };
      const n = Number(stripped);
      if (!Number.isFinite(n)) return { ok: false, reason: "nie jest liczbą" };
      return { ok: true, value: n };
    }

    case "date": {
      const s = joinText(raw);
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return { ok: false, reason: "nie jest datą" };
      return { ok: true, value: d.toISOString().slice(0, 10) };
    }

    case "boolean": {
      const s = joinText(raw).toLowerCase();
      if (["true", "tak", "yes", "1", "on"].includes(s)) return { ok: true, value: true };
      if (["false", "nie", "no", "0", "off", ""].includes(s)) return { ok: true, value: false };
      return { ok: false, reason: "nie jest wartością logiczną" };
    }

    case "select": {
      const s = joinText(raw);
      if (!s) return { ok: false, reason: "brak wartości" };
      const mapped = optionMap?.[s];
      if (!mapped) return { ok: false, reason: `opcja „${s}” nie jest zmapowana` };
      return { ok: true, value: mapped };
    }

    case "multi_select": {
      const arr = Array.isArray(raw) ? raw.map(String) : joinText(raw) ? [joinText(raw)] : [];
      if (arr.length === 0) return { ok: false, reason: "brak wartości" };
      const mapped = arr.map((v) => optionMap?.[v]).filter((v): v is string => !!v);
      if (mapped.length === 0) return { ok: false, reason: "żadna opcja nie jest zmapowana" };
      return { ok: true, value: mapped };
    }
  }
}

// ── Rozwiązanie wszystkich mapowań dla zgłoszenia ─────────────────────────
export type MappingWarning = { fieldId: string; property: string; reason: string };

export type MappedResult = {
  // Wbudowane pola leadu (kolumny na deals).
  builtin: { name?: string; email?: string; phone?: string; company?: string; value?: number };
  // Właściwości własne → deals.props (jsonb).
  props: Record<string, unknown>;
  warnings: MappingWarning[];
};

// Lookup typu właściwości własnej po kluczu (z property_defs). Zwraca undefined,
// gdy właściwość została usunięta/zarchiwizowana — traktujemy jak niezmapowaną.
export type PropTypeLookup = (key: string) => PropertyType | undefined;

export function resolveMappedValues(
  fields: FormField[],
  answers: Record<string, unknown>,
  propType: PropTypeLookup
): MappedResult {
  const result: MappedResult = { builtin: {}, props: {}, warnings: [] };

  for (const field of fields) {
    const m = field.mapping;
    if (!m || !m.property) continue;
    const raw = answers[field.id];
    if (raw == null || raw === "" || (Array.isArray(raw) && raw.length === 0)) continue;

    if (m.target === "builtin") {
      const targetType = BUILTIN_TARGET_TYPE[m.property];
      if (!targetType) continue;
      const c = coerceValue(raw, targetType, m.optionMap);
      if (!c.ok) {
        result.warnings.push({ fieldId: field.id, property: m.property, reason: c.reason });
        continue;
      }
      if (m.property === "value") result.builtin.value = Number(c.value) || 0;
      else (result.builtin as Record<string, unknown>)[m.property] = c.value;
    } else {
      // Właściwość własna — typ z property_defs. Usunięta właściwość → pomiń + ostrzeż.
      const t = propType(m.property);
      if (!t) {
        result.warnings.push({ fieldId: field.id, property: m.property, reason: "właściwość usunięta" });
        continue;
      }
      const c = coerceValue(raw, t, m.optionMap);
      if (!c.ok) {
        result.warnings.push({ fieldId: field.id, property: m.property, reason: c.reason });
        continue;
      }
      result.props[m.property] = c.value;
    }
  }

  return result;
}
