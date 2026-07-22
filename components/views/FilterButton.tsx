// components/views/FilterButton.tsx — kompaktowy przycisk „Filtr" (Attio-style)
// zastępujący dawny pełnowymiarowy pasek chipów. Aktywne filtry i ich edycja
// żyją w popoverze; na przycisku tylko licznik. Filtry są też synchronizowane
// z URL-em (?f=…, base64) — linki z filtrami działają jak dotąd.
"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { tokens, inputStyle, ghostButton, menuPanel } from "@/lib/ui";
import { useStages } from "@/lib/stages";
import type { StageLike } from "@/lib/types";
import type { Filter, FilterOperator } from "@/lib/filters";
import type { FieldDef, FieldOption } from "@/components/FilterBar";
import MIcon from "@/components/MaterialIcon";

function normOption(o: FieldOption): { key: string; label: string } {
  return typeof o === "string" ? { key: o, label: o } : o;
}

function defaultOperator(field: FieldDef): FilterOperator {
  if (field.type === "number" || field.type === "value") return "gt";
  if (field.type === "date") return "after";
  if (field.type === "tags") return "has_any";
  if (field.type === "stage" || field.type === "select") return "in";
  return "contains";
}

function defaultValue(field: FieldDef): unknown {
  return field.type === "stage" || field.type === "select" || field.type === "tags" ? [] : "";
}

export default function FilterButton({
  fields,
  filters,
  onChange,
}: {
  fields: FieldDef[];
  filters: Filter[];
  onChange: (filters: Filter[]) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { stages } = useStages();

  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Filtry z udostępnionego linku (?f=…) — odtwarzane raz przy montowaniu.
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const fParam = searchParams.get("f");
    if (!fParam) return;
    try {
      const decoded = JSON.parse(decodeURIComponent(atob(fParam)));
      if (Array.isArray(decoded)) onChange(decoded);
    } catch (e) {
      console.error("Błąd dekodowania filtrów z URL", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zapis filtrów do URL-a (do udostępniania linków) — reaguje też na zmiany
  // przychodzące z zewnątrz (wybór zapisanego widoku ustawia filtry na stronie),
  // żeby stary parametr ?f= nie „wracał" po odświeżeniu.
  // Pierwszy przebieg pomijamy: efekt hydratacji (wyżej) dopiero co odczytał
  // ?f= i wysłał filtry do rodzica — stan `filters` w tym renderze jest
  // jeszcze pusty i skasowałby parametr z URL-a.
  const skipFirstSync = useRef(true);
  useEffect(() => {
    if (skipFirstSync.current) {
      skipFirstSync.current = false;
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const encoded = filters.length > 0 ? btoa(encodeURIComponent(JSON.stringify(filters))) : null;
    if ((params.get("f") ?? null) === encoded) return;
    if (encoded) params.set("f", encoded);
    else params.delete("f");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const update = (next: Filter[]) => {
    onChange(next);
  };

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setPicking(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const count = filters.length;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          ...ghostButton,
          borderColor: count > 0 ? `${tokens.accent}55` : tokens.border,
          color: count > 0 ? tokens.accent : tokens.text,
          background: count > 0 ? tokens.accentSoft : "#fff",
        }}
      >
        <MIcon name="filter_list" size={16} />
        Filtr
        {count > 0 && (
          <span style={{ fontSize: 11, fontWeight: 600, background: tokens.accent, color: "#fff", borderRadius: 999, padding: "0 5px", lineHeight: "15px" }}>
            {count}
          </span>
        )}
      </button>

      {open && (
        <div style={{ ...menuPanel, position: "absolute", top: "100%", left: 0, marginTop: 6, zIndex: 45, width: 420, maxWidth: "calc(100vw - 32px)", padding: 12 }}>
          {filters.length === 0 && !picking && (
            <p style={{ margin: "0 0 10px", fontSize: 12.5, color: tokens.muted }}>Brak filtrów — wyświetlane są wszystkie rekordy.</p>
          )}

          {filters.map((f, i) => {
            const fieldDef = fields.find((x) => x.key === f.field);
            return (
              <FilterRow
                key={`${f.field}-${i}`}
                filter={f}
                field={fieldDef}
                stages={stages}
                onChange={(nf) => update(filters.map((x, xi) => (xi === i ? nf : x)))}
                onRemove={() => update(filters.filter((_, xi) => xi !== i))}
              />
            );
          })}

          {picking ? (
            <div style={{ maxHeight: 240, overflowY: "auto", border: `1px solid ${tokens.borderSoft}`, borderRadius: tokens.radiusSm, marginTop: 8 }}>
              {fields.map((f) => (
                <button
                  key={f.key}
                  onClick={() => {
                    update([...filters, { field: f.key, operator: defaultOperator(f), value: defaultValue(f) }]);
                    setPicking(false);
                  }}
                  style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 10px", border: "none", background: "none", cursor: "pointer", fontSize: 13, color: tokens.text }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = tokens.bg)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                >
                  {f.label}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
              <button
                onClick={() => setPicking(true)}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "none", background: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: tokens.accent, padding: "3px 0" }}
              >
                <MIcon name="add" size={15} /> Dodaj filtr
              </button>
              {filters.length > 0 && (
                <button
                  onClick={() => update([])}
                  style={{ border: "none", background: "none", cursor: "pointer", fontSize: 12, color: tokens.muted, padding: "3px 0" }}
                >
                  Wyczyść wszystko
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Jeden aktywny filtr: pole · operator · wartość · usuń.
function FilterRow({
  filter,
  field,
  stages,
  onChange,
  onRemove,
}: {
  filter: Filter;
  field?: FieldDef;
  stages: StageLike[];
  onChange: (f: Filter) => void;
  onRemove: () => void;
}) {
  return (
    <div style={{ border: `1px solid ${tokens.borderSoft}`, borderRadius: tokens.radiusSm, padding: "8px 10px", marginBottom: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: tokens.text, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          {field?.label ?? filter.field}
        </span>
        <select
          value={filter.operator}
          onChange={(e) => onChange({ ...filter, operator: e.target.value as FilterOperator })}
          style={{ ...inputStyle, width: 150, padding: "3px 7px", fontSize: 12.5 }}
        >
          {getOperators(field?.type).map((op) => (
            <option key={op.val} value={op.val}>
              {op.label}
            </option>
          ))}
        </select>
        <button
          onClick={onRemove}
          aria-label="Usuń filtr"
          style={{ border: "none", background: "none", cursor: "pointer", color: tokens.muted, display: "grid", placeItems: "center", padding: 2 }}
        >
          <MIcon name="close" size={15} />
        </button>
      </div>
      <div style={{ marginTop: 6 }}>
        <ValueInput field={field} operator={filter.operator} value={filter.value} stages={stages} onChange={(val) => onChange({ ...filter, value: val })} />
      </div>
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
  if (type === "tags") {
    return [{ val: "has_any", label: "Zawiera dowolny" }];
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
  value: unknown;
  onChange: (val: unknown) => void;
  stages: StageLike[];
}) {
  if (operator === "is_empty") return null;

  if (field?.type === "stage" || field?.type === "select" || field?.type === "tags") {
    const options =
      field.type === "stage" ? stages.map((s) => ({ key: s.key, label: s.label })) : field.options?.map(normOption) || [];
    const selected = Array.isArray(value) ? (value as string[]) : [];

    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {options.map((opt) => {
          const isSelected = selected.includes(opt.key);
          return (
            <label
              key={opt.key}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "3px 9px",
                borderRadius: 6,
                border: `1px solid ${isSelected ? tokens.accent : tokens.border}`,
                background: isSelected ? tokens.accentSoft : "#fff",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 500,
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
    const arr = Array.isArray(value) ? (value as unknown[]) : [];
    const v1 = (arr[0] as string) ?? "";
    const v2 = (arr[1] as string) ?? "";
    const type = field?.type === "date" ? "date" : "number";
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input type={type} value={v1 || ""} onChange={(e) => onChange([e.target.value, v2])} style={{ ...inputStyle, padding: "4px 8px" }} />
        <span style={{ color: tokens.muted }}>—</span>
        <input type={type} value={v2 || ""} onChange={(e) => onChange([v1, e.target.value])} style={{ ...inputStyle, padding: "4px 8px" }} />
      </div>
    );
  }

  if (operator === "last_n_days") {
    return (
      <input
        type="number"
        value={(value as string) || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Liczba dni…"
        style={{ ...inputStyle, padding: "4px 8px" }}
      />
    );
  }

  const type = field?.type === "date" ? "date" : field?.type === "number" || field?.type === "value" ? "number" : "text";

  return (
    <input
      type={type}
      value={(value as string) || ""}
      onChange={(e) => onChange(e.target.value)}
      style={{ ...inputStyle, padding: "4px 8px" }}
    />
  );
}
