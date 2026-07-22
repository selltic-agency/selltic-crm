// components/forms/SmsSettings.tsx — zakładka „SMS" w edytorze formularza.
// Konfiguracja automatów SMS po zgłoszeniu: potwierdzenie do zgłaszającego +
// alert wewnętrzny. Zapis do form_sms_settings (tabela server-only, nie w
// publicznym schemacie). Numery wewnętrzne walidowane jako E.164 przy zapisie.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, primaryButton, ghostButton } from "@/lib/ui";
import { useToast } from "@/components/Toast";
import type { FormSchema, Step } from "@/lib/forms";
import { stepFields } from "@/lib/forms";
import type { SmsTemplate } from "@/lib/types";
import { isE164, toE164 } from "@/lib/phone";
import { renderSmsTemplate, SMS_SAMPLE_VALUES } from "@/lib/sms/templates";
import { SmsCounter } from "@/components/sms/SmsCounter";
import MIcon from "@/components/MaterialIcon";

type FieldOpt = { id: string; label: string };

export default function SmsSettings({
  schema,
  formId,
  formTitle,
}: {
  schema: FormSchema;
  formId: string;
  formTitle: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();

  // Pola formularza wg typu (do selektorów).
  const { phoneFields, consentFields } = useMemo(() => {
    const phone: FieldOpt[] = [];
    const consent: FieldOpt[] = [];
    for (const step of (schema.steps ?? []) as Step[]) {
      for (const f of stepFields(step)) {
        const label = f.question?.trim() || f.id;
        if (f.type === "phone") phone.push({ id: f.id, label });
        if (f.type === "single_choice" || f.type === "multi_choice") consent.push({ id: f.id, label });
      }
    }
    return { phoneFields: phone, consentFields: consent };
  }, [schema]);

  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Migawka ostatnio zapisanej konfiguracji → wskaźnik „niezapisanych zmian" (item 6).
  const [savedSnapshot, setSavedSnapshot] = useState("");

  // Stan konfiguracji.
  const [enabled, setEnabled] = useState(false);
  const [confirmationEnabled, setConfirmationEnabled] = useState(false);
  const [confirmationTemplateId, setConfirmationTemplateId] = useState("");
  const [confirmationDelay, setConfirmationDelay] = useState(0);
  const [internalEnabled, setInternalEnabled] = useState(false);
  const [internalTemplateId, setInternalTemplateId] = useState("");
  const [internalRecipients, setInternalRecipients] = useState("");
  const [phoneFieldId, setPhoneFieldId] = useState("");
  const [consentFieldId, setConsentFieldId] = useState("");
  const [hourlyCap, setHourlyCap] = useState(50);

  // Test SMS.
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: tpls }, { data: cfg }] = await Promise.all([
      supabase.from("sms_templates").select("*").eq("is_active", true).order("updated_at", { ascending: false }),
      supabase.from("form_sms_settings").select("*").eq("form_id", formId).maybeSingle(),
    ]);
    setTemplates((tpls as SmsTemplate[]) ?? []);
    // Wartości domyślne / z bazy — zebrane też do migawki „zapisanego" stanu.
    const v = {
      enabled: !!cfg?.enabled,
      confirmationEnabled: !!cfg?.confirmation_enabled,
      confirmationTemplateId: (cfg?.confirmation_template_id as string) ?? "",
      confirmationDelay: (cfg?.confirmation_delay_seconds as number) ?? 0,
      internalEnabled: !!cfg?.internal_enabled,
      internalTemplateId: (cfg?.internal_template_id as string) ?? "",
      internalRecipients: ((cfg?.internal_recipients as string[]) ?? []).join("\n"),
      phoneFieldId: (cfg?.phone_field_id as string) ?? (!cfg && phoneFields.length === 1 ? phoneFields[0].id : ""),
      consentFieldId: (cfg?.consent_field_id as string) ?? "",
      hourlyCap: (cfg?.hourly_cap as number) ?? 50,
    };
    setEnabled(v.enabled);
    setConfirmationEnabled(v.confirmationEnabled);
    setConfirmationTemplateId(v.confirmationTemplateId);
    setConfirmationDelay(v.confirmationDelay);
    setInternalEnabled(v.internalEnabled);
    setInternalTemplateId(v.internalTemplateId);
    setInternalRecipients(v.internalRecipients);
    setPhoneFieldId(v.phoneFieldId);
    setConsentFieldId(v.consentFieldId);
    setHourlyCap(v.hourlyCap);
    // Migawka zapisu — jeśli formularz nie ma jeszcze konfiguracji, domyślny
    // wybór pola telefonu NIE liczy się jako niezapisana zmiana.
    setSavedSnapshot(JSON.stringify([
      v.enabled, v.confirmationEnabled, v.confirmationTemplateId, v.confirmationDelay,
      v.internalEnabled, v.internalTemplateId, v.internalRecipients, v.phoneFieldId, v.consentFieldId, v.hourlyCap,
    ]));
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, formId]);

  useEffect(() => {
    load();
  }, [load]);

  // Serializacja bieżącej konfiguracji (spójny porządek pól) do porównań.
  const currentSnapshot = JSON.stringify([
    enabled, confirmationEnabled, confirmationTemplateId, confirmationDelay,
    internalEnabled, internalTemplateId, internalRecipients, phoneFieldId, consentFieldId, hourlyCap,
  ]);
  const dirty = !loading && currentSnapshot !== savedSnapshot;

  const confirmationTpl = templates.find((t) => t.id === confirmationTemplateId) ?? null;
  const internalTpl = templates.find((t) => t.id === internalTemplateId) ?? null;
  const marketingWithoutConsent =
    confirmationEnabled && confirmationTpl?.kind === "marketing" && !consentFieldId;

  // Numery wewnętrzne (rozdzielone nowymi liniami/przecinkami) → walidacja E.164.
  function parseRecipients(): { valid: string[]; invalid: string[] } {
    const raw = internalRecipients.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    const valid: string[] = [];
    const invalid: string[] = [];
    for (const r of raw) {
      const e = toE164(r);
      if (e && isE164(e)) valid.push(e);
      else invalid.push(r);
    }
    return { valid, invalid };
  }

  async function save() {
    const { valid, invalid } = parseRecipients();
    if (internalEnabled && invalid.length > 0) {
      toast.error(`Nieprawidłowe numery odbiorców: ${invalid.join(", ")}. Użyj formatu E.164 (+48…).`);
      return;
    }
    if (confirmationEnabled && !confirmationTemplateId) {
      toast.error("Wybierz szablon potwierdzenia.");
      return;
    }
    if (confirmationEnabled && !phoneFieldId) {
      toast.error("Wskaż pole z numerem telefonu.");
      return;
    }
    if (internalEnabled && (!internalTemplateId || valid.length === 0)) {
      toast.error("Alert wewnętrzny wymaga szablonu i co najmniej jednego numeru.");
      return;
    }
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setSaving(false);
      toast.error("Brak autoryzacji.");
      return;
    }
    const { error } = await supabase.from("form_sms_settings").upsert(
      {
        form_id: formId,
        owner: user.id,
        enabled,
        confirmation_enabled: confirmationEnabled,
        confirmation_template_id: confirmationTemplateId || null,
        confirmation_delay_seconds: Math.max(0, Number(confirmationDelay) || 0),
        internal_enabled: internalEnabled,
        internal_template_id: internalTemplateId || null,
        internal_recipients: valid,
        phone_field_id: phoneFieldId || null,
        consent_field_id: consentFieldId || null,
        hourly_cap: Math.max(1, Number(hourlyCap) || 50),
      },
      { onConflict: "form_id" }
    );
    setSaving(false);
    if (error) {
      const missing = error.code === "PGRST205" || /form_sms_settings/i.test(error.message || "");
      toast.error(
        missing
          ? "Baza nie ma tabeli konfiguracji SMS. Uruchom migrację migration_sms_forms.sql."
          : `Nie udało się zapisać: ${error.message}`
      );
      return;
    }
    const normalizedRecipients = valid.join("\n");
    setInternalRecipients(normalizedRecipients);
    // Odśwież migawkę zapisu (znormalizowani odbiorcy) → wskaźnik wróci do „Zapisane".
    setSavedSnapshot(JSON.stringify([
      enabled, confirmationEnabled, confirmationTemplateId, confirmationDelay,
      internalEnabled, internalTemplateId, normalizedRecipients, phoneFieldId, consentFieldId, hourlyCap,
    ]));
    toast.success("Konfiguracja SMS zapisana.");
  }

  async function sendTest() {
    const e = toE164(testTo);
    if (!e) {
      toast.error("Podaj poprawny numer do testu.");
      return;
    }
    if (!confirmationTemplateId) {
      toast.error("Wybierz szablon potwierdzenia do testu.");
      return;
    }
    setTesting(true);
    try {
      const res = await fetch("/api/sms/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: e, templateId: confirmationTemplateId }),
      });
      const b = await res.json().catch(() => null);
      if (!res.ok) toast.error(b?.error || "Nie udało się wysłać testu.");
      else toast.success("Testowy SMS wysłany (lub zwalidowany w trybie testowym).");
    } catch {
      toast.error("Błąd sieci przy wysyłce testu.");
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <p style={{ color: tokens.muted }}>Wczytywanie…</p>;

  // Pusty stan: brak pola telefonu → automat nie ma dokąd wysyłać potwierdzenia.
  if (phoneFields.length === 0) {
    return (
      <section style={card}>
        <Header />
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", color: tokens.muted, fontSize: 13.5, marginTop: 8 }}>
          <MIcon name="info" size={18} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            Ten formularz nie ma pola typu <b>telefon</b>. Dodaj krok/pole „Telefon”, aby móc wysyłać
            automatyczne potwierdzenia SMS. Alert wewnętrzny do zespołu możesz skonfigurować mimo to —
            skorzystaj z zakładki po dodaniu pola telefonu.
          </div>
        </div>
      </section>
    );
  }

  return (
    <section style={{ ...card, display: "grid", gap: 18 }}>
      <Header />

      <Toggle label="Włącz automatyzację SMS dla tego formularza" checked={enabled} onChange={setEnabled} />

      <div style={{ opacity: enabled ? 1 : 0.5, pointerEvents: enabled ? "auto" : "none", display: "grid", gap: 18 }}>
        {/* Pole telefonu + zgoda */}
        <div style={{ display: "grid", gap: 12 }}>
          <Labeled label="Pole z numerem telefonu odbiorcy">
            <select value={phoneFieldId} onChange={(e) => setPhoneFieldId(e.target.value)} style={inputStyle}>
              <option value="">— wybierz pole —</option>
              {phoneFields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="Pole zgody marketingowej (opcjonalne)">
            <select value={consentFieldId} onChange={(e) => setConsentFieldId(e.target.value)} style={inputStyle}>
              <option value="">— brak —</option>
              {consentFields.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </Labeled>
        </div>

        {/* Potwierdzenie */}
        <div style={block}>
          <Toggle label="Potwierdzenie do zgłaszającego" checked={confirmationEnabled} onChange={setConfirmationEnabled} />
          {confirmationEnabled && (
            <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
              <Labeled label="Szablon potwierdzenia">
                <select value={confirmationTemplateId} onChange={(e) => setConfirmationTemplateId(e.target.value)} style={inputStyle}>
                  <option value="">— wybierz szablon —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} {t.kind === "marketing" ? "(marketing)" : ""}
                    </option>
                  ))}
                </select>
              </Labeled>
              <Labeled label="Opóźnienie wysyłki (sekundy, 0 = natychmiast)">
                <input
                  type="number"
                  min={0}
                  value={confirmationDelay}
                  onChange={(e) => setConfirmationDelay(Number(e.target.value))}
                  style={inputStyle}
                />
              </Labeled>
              {marketingWithoutConsent && (
                <div style={warn}>
                  <MIcon name="warning" size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  Wybrano szablon <b>marketingowy</b>, ale nie zmapowano pola zgody. Bez zaznaczonej zgody w
                  zgłoszeniu potwierdzenie NIE zostanie wysłane.
                </div>
              )}
              {confirmationTpl && <Preview title="Podgląd potwierdzenia" body={confirmationTpl.body} />}
            </div>
          )}
        </div>

        {/* Alert wewnętrzny */}
        <div style={block}>
          <Toggle label="Alert wewnętrzny do zespołu (Dominik + Jakub)" checked={internalEnabled} onChange={setInternalEnabled} />
          {internalEnabled && (
            <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
              <Labeled label="Szablon alertu">
                <select value={internalTemplateId} onChange={(e) => setInternalTemplateId(e.target.value)} style={inputStyle}>
                  <option value="">— wybierz szablon —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Labeled>
              <Labeled label="Numery odbiorców (E.164, po jednym w linii)">
                <textarea
                  value={internalRecipients}
                  onChange={(e) => setInternalRecipients(e.target.value)}
                  rows={3}
                  placeholder={"+48601234567\n+48602345678"}
                  style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
                />
              </Labeled>
              {internalTpl && <Preview title="Podgląd alertu" body={internalTpl.body} />}
            </div>
          )}
        </div>

        {/* Limit nadużyć */}
        <Labeled label="Limit SMS na formularz na godzinę (ochrona przed nadużyciem)">
          <input type="number" min={1} value={hourlyCap} onChange={(e) => setHourlyCap(Number(e.target.value))} style={{ ...inputStyle, maxWidth: 160 }} />
        </Labeled>
      </div>

      {/* Zapis */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={save} disabled={saving || !dirty} style={{ ...primaryButton, opacity: saving || !dirty ? 0.55 : 1, cursor: saving || !dirty ? "default" : "pointer" }}>
          {saving ? "Zapisywanie…" : "Zapisz konfigurację"}
        </button>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: dirty ? tokens.warning : tokens.success }}>
          {dirty ? "● Niezapisane zmiany" : "✓ Zapisane"}
        </span>
      </div>

      {/* Test SMS */}
      <div style={{ borderTop: `1px solid ${tokens.border}`, paddingTop: 16, display: "grid", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Wyślij testowy SMS na swój numer</span>
        <span style={{ fontSize: 12, color: tokens.muted }}>
          Używa wybranego szablonu potwierdzenia i przykładowych danych. Z trybem testowym nic nie zostanie dostarczone.
        </span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="+48601234567" style={{ ...inputStyle, maxWidth: 220 }} />
          <button onClick={sendTest} disabled={testing} style={{ ...ghostButton, display: "inline-flex", alignItems: "center", gap: 6 }}>
            <MIcon name="send" size={14} /> {testing ? "Wysyłanie…" : "Wyślij test"}
          </button>
        </div>
      </div>
    </section>
  );
}

function Header() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <MIcon name="chat" size={16} color={tokens.accent} />
      <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Automatyzacja SMS</h3>
    </div>
  );
}

function Preview({ title, body }: { title: string; body: string }) {
  const text = renderSmsTemplate(body, SMS_SAMPLE_VALUES, "graceful").text;
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: tokens.muted }}>{title}</span>
      <div style={{ padding: 12, border: `1px solid ${tokens.border}`, borderRadius: 10, background: tokens.bg, fontSize: 14, whiteSpace: "pre-wrap" }}>
        {text || "—"}
      </div>
      <SmsCounter text={text} />
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
    </label>
  );
}

const card = {
  background: tokens.card,
  border: `1px solid ${tokens.border}`,
  borderRadius: tokens.radius,
  padding: 20,
} as const;

const block = {
  border: `1px solid ${tokens.border}`,
  borderRadius: 12,
  padding: 14,
} as const;

const warn = {
  display: "flex",
  gap: 8,
  padding: "10px 12px",
  borderRadius: 10,
  background: "rgba(242,153,74,0.10)",
  border: "1px solid rgba(242,153,74,0.35)",
  color: "#8a5a1f",
  fontSize: 12.5,
} as const;
