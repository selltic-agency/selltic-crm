// components/prospecting/ConvertModal.tsx — modal „Konwertuj na lead".
// Dane prospektu wypełnione z góry; wybór DOWOLNEGO etapu lejka (etapy są
// definiowane przez użytkownika w Ustawieniach → ładowane dynamicznie,
// domyślnie pierwszy) oraz źródła kontaktu (domyślnie „Prospecting").
"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, primaryButton, ghostButton, menuPanel } from "@/lib/ui";
import type { Prospect } from "@/lib/types";
import { useStages } from "@/lib/stages";
import { useEntityProperties } from "@/lib/properties";
import { CONTACT_SOURCE_KEY, CONTACT_SOURCE_SEED } from "@/lib/contactSource";
import { useScrollLock } from "@/lib/useScrollLock";
import MIcon from "@/components/MaterialIcon";

export type ConvertOptions = {
  stage: string;
  contact_source: string;
  name: string;
  value: number;
};

export default function ConvertModal({
  prospect,
  onClose,
  onConvert,
}: {
  prospect: Prospect;
  onClose: () => void;
  /** Wywołuje endpoint konwersji; zwraca id deala albo null przy błędzie. */
  onConvert: (opts: ConvertOptions) => Promise<string | null>;
}) {
  // Supabase client trzymany na wypadek przyszłych rozszerzeń walidacji.
  useMemo(() => createClient(), []);
  useScrollLock();
  const { stages } = useStages();
  const { views } = useEntityProperties("deals");

  // Opcje „Źródła kontaktu" z definicji właściwości (edytowalne w Ustawieniach);
  // fallback: seed — gdy definicja jeszcze nie została dosiana.
  const sourceOptions = useMemo(() => {
    const def = views.find((v) => v.key === CONTACT_SOURCE_KEY);
    return def && def.options.length > 0 ? def.options : CONTACT_SOURCE_SEED;
  }, [views]);

  const [name, setName] = useState(prospect.name);
  const [value, setValue] = useState("");
  const [stage, setStage] = useState(stages[0]?.key ?? "new");
  const [source, setSource] = useState("prospecting");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    await onConvert({
      stage,
      contact_source: source,
      name: name.trim() || prospect.name,
      value: value ? Number(value) : 0,
    });
    setSaving(false);
  }

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,18,28,0.40)", zIndex: 110 }} />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          ...menuPanel,
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          width: "min(460px, calc(100vw - 32px))",
          boxShadow: tokens.shadowModal,
          zIndex: 111,
          padding: 20,
          overflow: "visible",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Konwertuj na lead</h2>
          <button onClick={onClose} aria-label="Zamknij" style={{ border: "none", background: "none", cursor: "pointer", color: tokens.muted, display: "grid", placeItems: "center", padding: 2 }}>
            <MIcon name="close" size={18} />
          </button>
        </div>

        <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
          <Field label="Nazwa deala">
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} autoFocus />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Etap lejka">
              <select value={stage} onChange={(e) => setStage(e.target.value)} style={inputStyle}>
                {stages.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Wartość (zł)">
              <input type="number" value={value} onChange={(e) => setValue(e.target.value)} style={inputStyle} placeholder="0" />
            </Field>
          </div>

          <Field label="Źródło kontaktu">
            <select value={source} onChange={(e) => setSource(e.target.value)} style={inputStyle}>
              {sourceOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          {/* Podgląd danych przenoszonych z prospektu */}
          <div style={{ border: `1px solid ${tokens.borderSoft}`, borderRadius: tokens.radiusSm, background: tokens.bg, padding: "8px 10px", fontSize: 12, color: tokens.muted, display: "grid", gap: 3 }}>
            <span>
              <strong style={{ color: tokens.text, fontWeight: 600 }}>Telefon:</strong> {prospect.phone || "—"}
            </span>
            <span>
              <strong style={{ color: tokens.text, fontWeight: 600 }}>Miasto:</strong> {prospect.city || "—"}
            </span>
            <span style={{ fontSize: 11.5 }}>Wszystkie dane z Google Maps zostaną przeniesione na deala.</span>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 2 }}>
            <button type="button" onClick={onClose} style={ghostButton}>
              Anuluj
            </button>
            <button type="submit" disabled={saving} style={{ ...primaryButton, background: tokens.success, opacity: saving ? 0.7 : 1 }}>
              <MIcon name="check_circle" size={16} />
              {saving ? "Konwertowanie…" : "Utwórz deal"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: tokens.muted }}>{label}</span>
      {children}
    </label>
  );
}
