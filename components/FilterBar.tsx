// components/FilterBar.tsx — pasek filtrowania kontaktów (Faza 8.4).
"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, X, Filter as FilterIcon, Calendar, ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, ghostButton, primaryButton } from "@/lib/ui";
import { useStages } from "@/lib/stages";
import { PropertyDef, PropertyType } from "@/lib/types";
import { Filter, FilterOperator } from "@/lib/filters";

type FieldDef = {
  key: string;
  label: string;
  type: PropertyType | "stage" | "source" | "value" | "date";
  options?: string[];
};

// Faza 9.4: filtry lejka rozdzielone na poziom LEADA i poziom KONTAKTU.
const LEAD_FIELDS: FieldDef[] = [
  { key: "stage", label: "Etap", type: "stage" },
  { key: "value", label: "Wartość", type: "value" },
  { key: "source", label: "Źródło", type: "source" },
  { key: "opened_at", label: "Data otwarcia", type: "date" },
];
const CONTACT_BUILT_IN_FIELDS: FieldDef[] = [
  { key: "name", label: "Nazwa", type: "text" },
  { key: "email", label: "E-mail", type: "text" },
  { key: "phone", label: "Telefon", type: "text" },
  { key: "company", label: "Firma", type: "text" },
];

export default function FilterBar({
  onFilterChange,
  scope = "all",
}: {
  onFilterChange: (filters: Filter[]) => void;
  scope?: "all" | "lead" | "contact";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const { stages } = useStages();

  const [propDefs, setPropDefs] = useState<PropertyDef[]>([]);
  const [filters, setFilters] = useState<Filter[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editingFilter, setEditingFilter] = useState<Partial<Filter> | null>(null);

  // Wczytaj definicje pól własnych.
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("property_defs")
        .select("*")
        .order("position", { ascending: true });
      if (data) setPropDefs(data as PropertyDef[]);
    })();
  }, [supabase]);

  // Synchronizacja z URL przy montowaniu.
  useEffect(() => {
    const fParam = searchParams.get("f");
    if (fParam) {
      try {
        const decoded = JSON.parse(decodeURIComponent(atob(fParam)));
        if (Array.isArray(decoded)) {
          setFilters(decoded);
          onFilterChange(decoded);
        }
      } catch (e) {
        console.error("Błąd dekodowania filtrów z URL", e);
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Aktualizuj URL i powiadom rodzica o zmianach.
  const updateFilters = (newFilters: Filter[]) => {
    setFilters(newFilters);
    onFilterChange(newFilters);

    const params = new URLSearchParams(searchParams.toString());
    if (newFilters.length > 0) {
      // btoa() fails on Unicode (Polish characters). Use encodeURIComponent + btoa.
      const json = JSON.stringify(newFilters);
      const encoded = btoa(encodeURIComponent(json));
      params.set("f", encoded);
    } else {
      params.delete("f");
    }
    router.replace(`${pathname}?${params.toString()}`);
  };

  // Pola kontaktu = wbudowane + właściwości własne (props).
  const contactFields = useMemo(() => {
    const custom: FieldDef[] = propDefs.map((p) => ({
      key: p.key,
      label: p.key,
      type: p.type,
      options: p.options || undefined,
    }));
    return [...CONTACT_BUILT_IN_FIELDS, ...custom];
  }, [propDefs]);

  const allFields = useMemo(() => {
    if (scope === "lead") return LEAD_FIELDS;
    if (scope === "contact") return contactFields;
    return [...LEAD_FIELDS, ...contactFields];
  }, [contactFields, scope]);

  const removeFilter = (index: number) => {
    updateFilters(filters.filter((_, i) => i !== index));
  };

  const clearAll = () => {
    updateFilters([]);
  };

  const addFilter = (field: FieldDef) => {
    const defaultOp: FilterOperator =
      field.type === "number" || field.type === "value" ? "gt" :
      field.type === "date" ? "after" :
      field.type === "stage" || field.type === "select" ? "in" : "contains";

    setEditingFilter({
      field: field.key,
      operator: defaultOp,
      value: field.type === "stage" || field.type === "select" ? [] : "",
    });
    setShowAdd(false);
  };

  const saveEditing = () => {
    if (editingFilter?.field && editingFilter?.operator) {
      updateFilters([...filters, editingFilter as Filter]);
      setEditingFilter(null);
    }
  };

  return (
    <div style={{ marginBottom: 16, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <div style={{ position: "relative" }}>
          <button
            onClick={() => setShowAdd(!showAdd)}
            style={{
              ...ghostButton,
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 12px",
              fontSize: 13,
            }}
          >
            <Plus size={16} />
            Dodaj filtr
          </button>

          {showAdd && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                marginTop: 6,
                zIndex: 30,
                background: "#fff",
                border: `1px solid ${tokens.border}`,
                borderRadius: 12,
                boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
                minWidth: 200,
                maxHeight: 300,
                overflowY: "auto",
                padding: 6,
              }}
            >
              {scope !== "contact" && (
                <FieldGroup label="Lead" fields={LEAD_FIELDS} onPick={addFilter} />
              )}
              {scope !== "lead" && (
                <FieldGroup label="Kontakt" fields={contactFields} onPick={addFilter} />
              )}
            </div>
          )}
        </div>

        {filters.map((f, i) => {
          const fieldDef = allFields.find((af) => af.key === f.field);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: tokens.accentSoft,
                color: tokens.accent,
                padding: "4px 10px",
                borderRadius: 99,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              <span>
                {fieldDef?.label}: {formatValue(f, fieldDef, stages)}
              </span>
              <button
                onClick={() => removeFilter(i)}
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  display: "flex",
                  padding: 0,
                  color: tokens.accent,
                }}
              >
                <X size={14} />
              </button>
            </div>
          );
        })}

        {filters.length > 0 && (
          <button
            onClick={clearAll}
            style={{
              border: "none",
              background: "none",
              color: tokens.muted,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              padding: "4px 8px",
            }}
          >
            Wyczyść wszystko
          </button>
        )}
      </div>

      {editingFilter && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            gap: 10,
            padding: 14,
            background: tokens.card,
            border: `1px solid ${tokens.border}`,
            borderRadius: 12,
          }}
        >
          <div style={{ display: "grid", gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: tokens.muted }}>POLE</span>
            <div style={{ fontSize: 14, fontWeight: 600, height: 38, display: "flex", alignItems: "center" }}>
              {allFields.find((f) => f.key === editingFilter.field)?.label}
            </div>
          </div>

          <div style={{ display: "grid", gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: tokens.muted }}>OPERATOR</span>
            <select
              value={editingFilter.operator}
              onChange={(e) =>
                setEditingFilter({ ...editingFilter, operator: e.target.value as FilterOperator })
              }
              style={{ ...inputStyle, width: 140 }}
            >
              {getOperators(allFields.find((f) => f.key === editingFilter.field)?.type).map((op) => (
                <option key={op.val} value={op.val}>
                  {op.label}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gap: 5, flex: 1, minWidth: 150 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: tokens.muted }}>WARTOŚĆ</span>
            <ValueInput
              field={allFields.find((f) => f.key === editingFilter.field)}
              operator={editingFilter.operator}
              value={editingFilter.value}
              onChange={(val) => setEditingFilter({ ...editingFilter, value: val })}
              stages={stages}
            />
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setEditingFilter(null)} style={ghostButton}>
              Anuluj
            </button>
            <button onClick={saveEditing} style={{ ...primaryButton, padding: "9px 18px" }}>
              Zastosuj
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Grupa pól w rozwijanej liście „Dodaj filtr" (Lead / Kontakt).
function FieldGroup({
  label,
  fields,
  onPick,
}: {
  label: string;
  fields: FieldDef[];
  onPick: (f: FieldDef) => void;
}) {
  if (fields.length === 0) return null;
  return (
    <div>
      <div
        style={{
          padding: "8px 10px 4px",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color: tokens.muted,
        }}
      >
        {label}
      </div>
      {fields.map((f) => (
        <button
          key={f.key}
          onClick={() => onPick(f)}
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "8px 10px",
            border: "none",
            background: "none",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 13,
            color: tokens.text,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
          onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

function getOperators(type: FieldDef["type"] | undefined) {
  if (type === "number" || type === "value") {
    return [
      { val: "gt", label: "Większe niż" },
      { val: "lt", label: "Mniejsze niż" },
      { val: "between", label: "Pomiędzy" },
      { val: "equals", label: "Równe" },
    ];
  }
  if (type === "date") {
    return [
      { val: "after", label: "Po dacie" },
      { val: "before", label: "Przed datą" },
      { val: "last_n_days", label: "W ostatnich N dniach" },
      { val: "between", label: "Pomiędzy" },
    ];
  }
  if (type === "stage" || type === "select") {
    return [{ val: "in", label: "Należy do" }];
  }
  return [
    { val: "contains", label: "Zawiera" },
    { val: "equals", label: "Równe" },
    { val: "is_empty", label: "Jest puste" },
  ];
}

function ValueInput({
  field,
  operator,
  value,
  onChange,
  stages,
}: {
  field?: FieldDef;
  operator?: FilterOperator;
  value: any;
  onChange: (val: any) => void;
  stages: any[];
}) {
  if (operator === "is_empty") return null;

  if (field?.type === "stage" || field?.type === "select") {
    const options = field.type === "stage"
      ? stages.map(s => ({ key: s.key, label: s.label }))
      : field.options?.map(o => ({ key: o, label: o })) || [];

    const selected = Array.isArray(value) ? value : [];

    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "4px 0" }}>
        {options.map((opt) => {
          const isSelected = selected.includes(opt.key);
          return (
            <label
              key={opt.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: 8,
                border: `1px solid ${isSelected ? tokens.accent : tokens.border}`,
                background: isSelected ? tokens.accentSoft : "#fff",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                color: isSelected ? tokens.accent : tokens.text,
              }}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={(e) => {
                  if (e.target.checked) onChange([...selected, opt.key]);
                  else onChange(selected.filter((k) => k !== opt.key));
                }}
                style={{ display: "none" }}
              />
              {opt.label}
            </label>
          );
        })}
      </div>
    );
  }

  if (operator === "between") {
    const v1 = Array.isArray(value) ? value[0] : "";
    const v2 = Array.isArray(value) ? value[1] : "";
    const type = field?.type === "date" ? "date" : "number";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type={type}
          value={v1 || ""}
          onChange={(e) => onChange([e.target.value, v2])}
          style={inputStyle}
        />
        <span style={{ color: tokens.muted }}>—</span>
        <input
          type={type}
          value={v2 || ""}
          onChange={(e) => onChange([v1, e.target.value])}
          style={inputStyle}
        />
      </div>
    );
  }

  if (operator === "last_n_days") {
    return (
      <div style={{ position: "relative" }}>
        <input
          type="number"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Liczba dni..."
          style={inputStyle}
        />
      </div>
    );
  }

  const type = field?.type === "date" ? "date" :
               field?.type === "number" || field?.type === "value" ? "number" : "text";

  return (
    <input
      type={type}
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      style={inputStyle}
    />
  );
}

function formatValue(f: Filter, fieldDef?: FieldDef, stages?: any[]): string {
  if (f.operator === "is_empty") return "puste";
  if (f.operator === "between") {
    return `${f.value[0]} do ${f.value[1]}`;
  }
  if (f.operator === "last_n_days") {
    return `ostatnie ${f.value} dni`;
  }
  if (Array.isArray(f.value)) {
    if (fieldDef?.type === "stage") {
      return f.value.map(k => stages?.find(s => s.key === k)?.label || k).join(", ");
    }
    return f.value.join(", ");
  }
  return String(f.value);
}
