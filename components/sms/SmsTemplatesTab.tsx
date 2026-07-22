// components/sms/SmsTemplatesTab.tsx — Ustawienia → Szablony SMS.
// CRUD szablonów SMS (nazwa, treść z {{zmiennymi}}, rodzaj transakcyjny/marketingowy,
// „automatyczny" = do automatów formularzy). Plus wybór szablonu przypomnień o
// spotkaniach (app_settings.sms_reminder_template_id). Zapis przez klienta
// Supabase (RLS: own templates).
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, primaryButton, ghostButton } from "@/lib/ui";
import { useToast } from "@/components/Toast";
import type { SmsKind, SmsTemplate } from "@/lib/types";
import { SMS_VARIABLES, SMS_SAMPLE_VALUES, renderSmsTemplate } from "@/lib/sms/templates";
import { isGsm7, stripDiacritics } from "@/lib/sms/encoding";
import { SmsCounter } from "@/components/sms/SmsCounter";
import MIcon from "@/components/MaterialIcon";

const DEFAULT_BODY = "Czesc {{first_name}}, dziekujemy za kontakt. Odezwiemy sie wkrotce. Zespol Selltic";

const KIND_LABEL: Record<SmsKind, string> = {
  transactional: "Transakcyjny",
  marketing: "Marketingowy",
};

type Editing = { mode: "new" } | { mode: "edit"; id: string } | null;

export function SmsTemplatesTab() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const [templates, setTemplates] = useState<SmsTemplate[]>([]);
  const [reminderTemplateId, setReminderTemplateId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Editing>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: tpls }, { data: userData }] = await Promise.all([
      supabase.from("sms_templates").select("*").order("updated_at", { ascending: false }),
      supabase.auth.getUser(),
    ]);
    setTemplates((tpls as SmsTemplate[]) ?? []);
    const uid = userData.user?.id;
    if (uid) {
      const { data: s } = await supabase
        .from("app_settings")
        .select("sms_reminder_template_id")
        .eq("owner", uid)
        .maybeSingle();
      setReminderTemplateId((s?.sms_reminder_template_id as string) ?? "");
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(t: SmsTemplate) {
    if (!window.confirm(`Usunąć szablon „${t.name}”?`)) return;
    setTemplates((list) => list.filter((x) => x.id !== t.id));
    const { error } = await supabase.from("sms_templates").delete().eq("id", t.id);
    if (error) {
      toast.error("Nie udało się usunąć szablonu.");
      await load();
      return;
    }
    toast.success("Szablon usunięty.");
  }

  async function saveReminderTemplate(id: string) {
    setReminderTemplateId(id);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
      .from("app_settings")
      .upsert({ owner: user.id, sms_reminder_template_id: id || null }, { onConflict: "owner" });
    if (error) toast.error("Nie udało się zapisać szablonu przypomnień.");
    else toast.success("Szablon przypomnień zapisany.");
  }

  if (editing) {
    const current = editing.mode === "edit" ? templates.find((t) => t.id === editing.id) ?? null : null;
    return (
      <TemplateEditor
        initial={current}
        onCancel={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
      />
    );
  }

  return (
    <section style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MIcon name="chat" size={16} color={tokens.accent} />
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Szablony SMS</h3>
        </div>
        <button onClick={() => setEditing({ mode: "new" })} style={{ ...primaryButton, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <MIcon name="add" size={15} /> Nowy szablon
        </button>
      </div>
      <p style={{ fontSize: 13, color: tokens.muted, margin: "0 0 16px" }}>
        Gotowe treści SMS z polami dynamicznymi (np. <code>{`{{first_name}}`}</code>). Użyjesz ich przy
        wysyłce z karty leada oraz w automatach formularzy.
      </p>

      {loading ? (
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      ) : (
        <>
          {/* Szablon przypomnień o spotkaniach (cron godzinowy). */}
          <label style={{ display: "grid", gap: 6, marginBottom: 18 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Szablon przypomnień o spotkaniach</span>
            <span style={{ fontSize: 12, color: tokens.muted }}>
              Wysyłany automatycznie na 24 h przed terminem zadania powiązanego z leadem, który ma numer telefonu.
            </span>
            <select value={reminderTemplateId} onChange={(e) => saveReminderTemplate(e.target.value)} style={inputStyle}>
              <option value="">— brak (przypomnienia wyłączone) —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>

          {templates.length === 0 ? (
            <div style={emptyStyle}>Brak szablonów. Kliknij „Nowy szablon”, aby utworzyć pierwszy.</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {templates.map((t) => (
                <div key={t.id} style={rowStyle}>
                  <div style={iconWrap}>
                    <MIcon name="chat" size={16} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: tokens.text, display: "flex", alignItems: "center", gap: 8 }}>
                      {t.name}
                      <Badge label={KIND_LABEL[t.kind]} tone={t.kind === "marketing" ? "warning" : "muted"} />
                      {t.automated && <Badge label="Automatyczny" tone="accent" />}
                      {!t.is_active && <Badge label="Nieaktywny" tone="muted" />}
                    </div>
                    <div style={{ fontSize: 12.5, color: tokens.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {renderSmsTemplate(t.body, SMS_SAMPLE_VALUES, "graceful").text || "— brak treści —"}
                    </div>
                  </div>
                  <button onClick={() => setEditing({ mode: "edit", id: t.id })} title="Edytuj" aria-label="Edytuj" style={iconBtn(tokens.muted)}>
                    <MIcon name="edit" size={15} />
                  </button>
                  <button onClick={() => remove(t)} title="Usuń" aria-label="Usuń" style={iconBtn(tokens.danger)}>
                    <MIcon name="delete" size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function TemplateEditor({
  initial,
  onCancel,
  onSaved,
}: {
  initial: SmsTemplate | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [body, setBody] = useState(initial?.body ?? DEFAULT_BODY);
  const [kind, setKind] = useState<SmsKind>(initial?.kind ?? "transactional");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [automated, setAutomated] = useState(initial?.automated ?? false);
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Diakrytyki w szablonie automatycznym wymuszają UCS-2 (70 zn./segment) — blokada.
  const diacriticsInAutomated = automated && !isGsm7(body);
  const preview = renderSmsTemplate(body, SMS_SAMPLE_VALUES, "graceful").text;

  function insertVariable(key: string) {
    const el = bodyRef.current;
    const token = `{{${key}}}`;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const start = el.selectionStart ?? body.length;
    const end = el.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function save() {
    if (!name.trim()) {
      toast.error("Podaj nazwę szablonu.");
      return;
    }
    if (diacriticsInAutomated) {
      toast.error("Szablon automatyczny nie może zawierać polskich znaków. Użyj „Usuń diakrytyki”.");
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
    const payload = { name: name.trim(), body, kind, is_active: isActive, automated };
    const { error } = initial
      ? await supabase.from("sms_templates").update(payload).eq("id", initial.id)
      : await supabase.from("sms_templates").insert({ owner: user.id, created_by: user.id, ...payload });
    setSaving(false);
    if (error) {
      const missing = error.code === "PGRST205" || /sms_templates/i.test(error.message || "");
      toast.error(
        missing
          ? "Baza nie ma tabeli szablonów SMS. Uruchom migrację migration_sms.sql."
          : `Nie udało się zapisać: ${error.message}`
      );
      return;
    }
    toast.success(initial ? "Szablon zaktualizowany." : "Szablon utworzony.");
    onSaved();
  }

  return (
    <section style={{ ...cardStyle, display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{initial ? "Edytuj szablon SMS" : "Nowy szablon SMS"}</h3>
        <button onClick={onCancel} style={ghostButton}>
          Wróć do listy
        </button>
      </div>

      <label style={{ display: "grid", gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Nazwa szablonu</span>
        <span style={{ fontSize: 12, color: tokens.muted }}>Tylko do Twojej identyfikacji — nie trafia do SMS-a.</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Potwierdzenie zgłoszenia" style={inputStyle} />
      </label>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <label style={{ display: "grid", gap: 6, flex: "1 1 200px" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>Rodzaj</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as SmsKind)} style={inputStyle}>
            <option value="transactional">Transakcyjny</option>
            <option value="marketing">Marketingowy (wymaga zgody)</option>
          </select>
        </label>
        <label style={{ display: "flex", alignItems: "flex-end", gap: 8, paddingBottom: 10 }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span style={{ fontSize: 13.5 }}>Aktywny</span>
        </label>
        <label style={{ display: "flex", alignItems: "flex-end", gap: 8, paddingBottom: 10 }}>
          <input type="checkbox" checked={automated} onChange={(e) => setAutomated(e.target.checked)} />
          <span style={{ fontSize: 13.5 }}>Automatyczny (formularze) — bez diakrytyków</span>
        </label>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Treść</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {SMS_VARIABLES.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => insertVariable(v.key)}
              style={{ ...ghostButton, padding: "4px 10px", fontSize: 12 }}
              title={`Wstaw ${v.label}`}
            >
              {`{{${v.key}}}`}
            </button>
          ))}
        </div>
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
        />
        <SmsCounter text={preview} />
      </div>

      {diacriticsInAutomated && (
        <div style={warnBox}>
          <MIcon name="warning" size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1 }}>
            Szablon <b>automatyczny</b> zawiera polskie znaki, które wymuszają kodowanie Unicode (70 znaków/segment
            zamiast 160). Usuń diakrytyki, aby zmieścić się w GSM-7.
            <div style={{ marginTop: 8 }}>
              <button type="button" onClick={() => setBody(stripDiacritics(body))} style={{ ...primaryButton, padding: "6px 12px", fontSize: 13 }}>
                Usuń diakrytyki
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "grid", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: tokens.muted }}>
          Podgląd (przykładowe dane)
        </span>
        <div style={{ padding: 12, border: `1px solid ${tokens.border}`, borderRadius: 10, background: tokens.bg, fontSize: 14, whiteSpace: "pre-wrap" }}>
          {preview || "—"}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={save} disabled={saving} style={{ ...primaryButton, opacity: saving ? 0.6 : 1 }}>
          {saving ? "Zapisywanie…" : "Zapisz szablon"}
        </button>
        <button onClick={onCancel} style={ghostButton}>
          Anuluj
        </button>
      </div>
    </section>
  );
}

// ── Style współdzielone ──────────────────────────────────────────────────
const cardStyle = {
  background: tokens.card,
  border: `1px solid ${tokens.border}`,
  borderRadius: tokens.radius,
  padding: 20,
} as const;

const emptyStyle = {
  border: `1px dashed ${tokens.border}`,
  borderRadius: 12,
  padding: 24,
  textAlign: "center" as const,
  color: tokens.muted,
  fontSize: 14,
};

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "12px 14px",
  border: `1px solid ${tokens.border}`,
  borderRadius: 12,
} as const;

const iconWrap = {
  width: 34,
  height: 34,
  borderRadius: 9,
  flexShrink: 0,
  background: tokens.accentSoft,
  color: tokens.accent,
  display: "grid",
  placeItems: "center",
} as const;

const warnBox = {
  display: "flex",
  gap: 10,
  padding: "12px 14px",
  borderRadius: 10,
  background: "rgba(242,153,74,0.10)",
  border: `1px solid rgba(242,153,74,0.35)`,
  color: "#8a5a1f",
  fontSize: 13,
} as const;

function iconBtn(color: string) {
  return {
    width: 32,
    height: 32,
    borderRadius: 8,
    flexShrink: 0,
    border: `1px solid ${tokens.border}`,
    background: "#fff",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    color,
  } as const;
}

function Badge({ label, tone }: { label: string; tone: "accent" | "warning" | "muted" }) {
  const colors =
    tone === "accent"
      ? { bg: tokens.accentSoft, fg: tokens.accent }
      : tone === "warning"
      ? { bg: "rgba(242,153,74,0.14)", fg: tokens.warning }
      : { bg: tokens.bg, fg: tokens.muted };
  return (
    <span style={{ padding: "1px 7px", borderRadius: 999, fontSize: 11, fontWeight: 600, background: colors.bg, color: colors.fg }}>
      {label}
    </span>
  );
}
