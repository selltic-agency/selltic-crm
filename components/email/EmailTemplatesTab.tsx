// components/email/EmailTemplatesTab.tsx — Ustawienia → Szablony e-mail.
// CRUD szablonów wielokrotnego użytku: nazwa (wewnętrzna), temat, treść HTML
// z placeholderami {{first_name}} itd. + podgląd na przykładowych danych.
// Zapis/odczyt idzie bezpośrednio przez klienta Supabase (RLS: own templates).
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { tokens, inputStyle, primaryButton, ghostButton } from "@/lib/ui";
import { useToast } from "@/components/Toast";
import type { EmailTemplate } from "@/lib/types";
import { SAMPLE_VALUES, renderText } from "@/lib/emailTemplates";
import { RichTextEditor, SubjectField, TemplatePreview } from "@/components/email/EmailComposer";
import MIcon from "@/components/MaterialIcon";

const DEFAULT_BODY = `<p>Cześć {{first_name}},</p>
<p>piszę z Selltic. Zauważyłem, że {{company}} działa w branży {{industry}} — mamy kilka pomysłów, które mogą pomóc pozyskać więcej klientów.</p>
<p>Czy znajdzie Pan/Pani 15 minut na krótką rozmowę?</p>
<p>Pozdrawiam,<br/>Zespół Selltic</p>`;

type Editing =
  | { mode: "new" }
  | { mode: "edit"; id: string }
  | null;

export function EmailTemplatesTab() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Editing>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("email_templates")
      .select("*")
      .order("updated_at", { ascending: false });
    setTemplates((data as EmailTemplate[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(t: EmailTemplate) {
    if (!window.confirm(`Usunąć szablon „${t.name}”?`)) return;
    setTemplates((list) => list.filter((x) => x.id !== t.id));
    const { error } = await supabase.from("email_templates").delete().eq("id", t.id);
    if (error) {
      toast.error("Nie udało się usunąć szablonu.");
      await load();
      return;
    }
    toast.success("Szablon usunięty.");
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
    <section
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        padding: 20,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <MIcon name="description" size={16} color={tokens.accent} />
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Szablony e-mail</h3>
        </div>
        <button onClick={() => setEditing({ mode: "new" })} style={{ ...primaryButton, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <MIcon name="add" size={15} /> Nowy szablon
        </button>
      </div>
      <p style={{ fontSize: 13, color: tokens.muted, margin: "0 0 18px" }}>
        Gotowe szablony wiadomości z polami dynamicznymi (np. <code>{`{{first_name}}`}</code>,{" "}
        <code>{`{{company}}`}</code>). Wyślesz je jednym kliknięciem z karty leada — pola wypełnią się
        jego danymi.
      </p>

      {loading ? (
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      ) : templates.length === 0 ? (
        <div
          style={{
            border: `1px dashed ${tokens.border}`,
            borderRadius: 12,
            padding: 24,
            textAlign: "center",
            color: tokens.muted,
            fontSize: 14,
          }}
        >
          Brak szablonów. Kliknij „Nowy szablon”, aby utworzyć pierwszy.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {templates.map((t) => (
            <div
              key={t.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 14px",
                border: `1px solid ${tokens.border}`,
                borderRadius: 12,
              }}
            >
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  flexShrink: 0,
                  background: tokens.accentSoft,
                  color: tokens.accent,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                <MIcon name="mail" size={16} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: tokens.text }}>{t.name}</div>
                <div style={{ fontSize: 12.5, color: tokens.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {renderText(t.subject, SAMPLE_VALUES) || "— brak tematu —"}
                </div>
              </div>
              <button
                onClick={() => setEditing({ mode: "edit", id: t.id })}
                title="Edytuj"
                aria-label="Edytuj"
                style={iconBtn(tokens.muted)}
              >
                <MIcon name="edit" size={15} />
              </button>
              <button onClick={() => remove(t)} title="Usuń" aria-label="Usuń" style={iconBtn(tokens.danger)}>
                <MIcon name="delete" size={15} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

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

// ── Edytor pojedynczego szablonu ────────────────────────────────────────────
function TemplateEditor({
  initial,
  onCancel,
  onSaved,
}: {
  initial: EmailTemplate | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const [name, setName] = useState(initial?.name ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [body, setBody] = useState(initial?.body ?? DEFAULT_BODY);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name.trim()) {
      toast.error("Podaj nazwę szablonu.");
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
    const payload = { name: name.trim(), subject, body };
    const { error } = initial
      ? await supabase.from("email_templates").update(payload).eq("id", initial.id)
      : await supabase.from("email_templates").insert({ owner: user.id, ...payload });
    setSaving(false);
    if (error) {
      const missing = error.code === "PGRST205" || /email_templates/i.test(error.message || "");
      toast.error(
        missing
          ? "Baza nie ma tabeli szablonów. Uruchom migrację migration_email_templates.sql."
          : `Nie udało się zapisać: ${error.message}`
      );
      return;
    }
    toast.success(initial ? "Szablon zaktualizowany." : "Szablon utworzony.");
    onSaved();
  }

  return (
    <section
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        padding: 20,
        display: "grid",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>
          {initial ? "Edytuj szablon" : "Nowy szablon"}
        </h3>
        <button onClick={onCancel} style={ghostButton}>
          Wróć do listy
        </button>
      </div>

      <label style={{ display: "grid", gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Nazwa szablonu</span>
        <span style={{ fontSize: 12, color: tokens.muted }}>Tylko do Twojej identyfikacji — nie trafia do maila.</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="np. Pierwszy kontakt — cold mail" style={inputStyle} />
      </label>

      <label style={{ display: "grid", gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Temat</span>
        <SubjectField value={subject} onChange={setSubject} placeholder="np. {{first_name}}, pomysł dla {{company}}" />
      </label>

      <div style={{ display: "grid", gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Treść</span>
        <span style={{ fontSize: 12, color: tokens.muted }}>
          Formatuj tekst (pogrubienie, kursywa, linki) i wstawiaj pola dynamiczne przyciskiem „Wstaw pole”.
        </span>
        <RichTextEditor initialHtml={initial?.body ?? DEFAULT_BODY} onChange={setBody} />
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: tokens.muted }}>
          Podgląd (przykładowe dane)
        </span>
        <TemplatePreview subject={subject} body={body} values={SAMPLE_VALUES} />
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={save} disabled={saving} style={primaryButton}>
          {saving ? "Zapisywanie…" : "Zapisz szablon"}
        </button>
        <button onClick={onCancel} style={ghostButton}>
          Anuluj
        </button>
      </div>
    </section>
  );
}
