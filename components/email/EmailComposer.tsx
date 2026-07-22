// components/email/EmailComposer.tsx — współdzielone elementy edytora e-mail:
//   • FieldMenu       — picker pól dynamicznych ({{first_name}} itd.),
//   • RichTextEditor  — proste WYSIWYG (pogrubienie/kursywa/link) na contentEditable,
//   • SubjectField    — pole tematu z pickerem wstawiającym pole w miejsce kursora,
//   • TemplatePreview — podgląd tematu + treści z podstawionymi danymi.
// Używane w Ustawienia → Szablony e-mail oraz w modalu „Wyślij e-mail” na leadzie.
"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { tokens, inputStyle } from "@/lib/ui";
import { TEMPLATE_FIELDS, renderText, renderHtml } from "@/lib/emailTemplates";
import MIcon from "@/components/MaterialIcon";

// ── Picker pól dynamicznych ────────────────────────────────────────────────
export function FieldMenu({ onInsert }: { onInsert: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        // preventDefault, żeby nie odbierać zaznaczenia edytorowi.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "5px 10px",
          borderRadius: 8,
          border: `1px solid ${tokens.border}`,
          background: "#fff",
          fontSize: 12.5,
          fontWeight: 600,
          color: tokens.accent,
          cursor: "pointer",
        }}
      >
        Wstaw pole <MIcon name="expand_more" size={13} />
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 30,
            background: "#fff",
            border: `1px solid ${tokens.border}`,
            borderRadius: 10,
            boxShadow: "0 10px 30px rgba(15,18,28,0.14)",
            padding: 6,
            width: 230,
            maxHeight: 260,
            overflowY: "auto",
          }}
        >
          {TEMPLATE_FIELDS.map((f) => (
            <button
              key={f.key}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onInsert(f.key);
                setOpen(false);
              }}
              style={{
                display: "flex",
                width: "100%",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 8,
                padding: "7px 9px",
                borderRadius: 7,
                border: "none",
                background: "none",
                cursor: "pointer",
                textAlign: "left",
                fontSize: 13,
                color: tokens.text,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = tokens.accentSoft)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
            >
              <span>{f.label}</span>
              <code style={{ fontSize: 11, color: tokens.muted }}>{`{{${f.key}}}`}</code>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Pole tematu z pickerem wstawiającym {{pole}} w miejsce kursora ─────────
export function SubjectField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  function insertField(key: string) {
    const el = ref.current;
    const token = `{{${key}}}`;
    if (!el) {
      onChange(value + token);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    onChange(next);
    // Przywróć kursor za wstawionym tokenem.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
      <div>
        <FieldMenu onInsert={insertField} />
      </div>
    </div>
  );
}

// ── Prosty edytor WYSIWYG (contentEditable) ────────────────────────────────
// Treść inicjalizujemy raz przy montażu (reset przez zmianę propa `key`).
// Zaznaczenie zapisujemy na blur/keyup/mouseup, by picker/przyciski mogły
// wstawiać treść w miejscu kursora mimo utraty fokusu.
export function RichTextEditor({
  initialHtml,
  onChange,
  minHeight = 200,
}: {
  initialHtml: string;
  onChange: (html: string) => void;
  minHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);

  useEffect(() => {
    if (ref.current) ref.current.innerHTML = initialHtml || "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function emit() {
    if (ref.current) onChange(ref.current.innerHTML);
  }
  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && ref.current && ref.current.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  }
  function restoreSelection() {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel) return;
    if (savedRange.current && el.contains(savedRange.current.commonAncestorContainer)) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    } else {
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
    }
  }
  function exec(cmd: string, val?: string) {
    restoreSelection();
    document.execCommand(cmd, false, val);
    saveSelection();
    emit();
  }
  function insertField(key: string) {
    restoreSelection();
    document.execCommand("insertText", false, `{{${key}}}`);
    saveSelection();
    emit();
  }
  function insertLink() {
    const url = window.prompt("Adres URL linku:", "https://");
    if (!url) return;
    restoreSelection();
    const sel = window.getSelection();
    if (sel && sel.isCollapsed) {
      document.execCommand("insertHTML", false, `<a href="${url}">${url}</a>`);
    } else {
      document.execCommand("createLink", false, url);
    }
    saveSelection();
    emit();
  }

  const toolBtn: CSSProperties = {
    width: 30,
    height: 30,
    display: "grid",
    placeItems: "center",
    borderRadius: 8,
    border: `1px solid ${tokens.border}`,
    background: "#fff",
    cursor: "pointer",
    color: tokens.text,
  };

  return (
    <div style={{ border: `1px solid ${tokens.border}`, borderRadius: 12, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: 8,
          borderBottom: `1px solid ${tokens.border}`,
          background: tokens.bg,
          flexWrap: "wrap",
        }}
      >
        <button type="button" title="Pogrubienie" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("bold")} style={toolBtn}>
          <MIcon name="format_bold" size={15} />
        </button>
        <button type="button" title="Kursywa" onMouseDown={(e) => e.preventDefault()} onClick={() => exec("italic")} style={toolBtn}>
          <MIcon name="format_italic" size={15} />
        </button>
        <button type="button" title="Wstaw link" onMouseDown={(e) => e.preventDefault()} onClick={insertLink} style={toolBtn}>
          <MIcon name="link" size={15} />
        </button>
        <div style={{ width: 1, height: 20, background: tokens.border, margin: "0 2px" }} />
        <FieldMenu onInsert={insertField} />
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={saveSelection}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        style={{
          minHeight,
          padding: "12px 14px",
          fontSize: 14,
          lineHeight: 1.6,
          color: tokens.text,
          outline: "none",
          overflowY: "auto",
          maxHeight: 360,
        }}
      />
    </div>
  );
}

// ── Podgląd tematu + treści z podstawionymi wartościami ────────────────────
export function TemplatePreview({
  subject,
  body,
  values,
}: {
  subject: string;
  body: string;
  values: Record<string, string>;
}) {
  return (
    <div
      style={{
        border: `1px solid ${tokens.border}`,
        borderRadius: 12,
        overflow: "hidden",
        background: "#fff",
      }}
    >
      <div style={{ padding: "10px 14px", borderBottom: `1px solid ${tokens.border}`, background: tokens.bg }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: tokens.muted }}>
          Temat
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: tokens.text, marginTop: 2 }}>
          {renderText(subject, values) || <span style={{ color: tokens.muted }}>— brak tematu —</span>}
        </div>
      </div>
      <div
        style={{ padding: "14px 16px", fontSize: 14, lineHeight: 1.6, color: tokens.text }}
        // Treść to HTML autorstwa właściciela; wartości leada są escapowane w renderHtml.
        dangerouslySetInnerHTML={{ __html: renderHtml(body, values) || "<p style='color:#8A92A6'>— brak treści —</p>" }}
      />
    </div>
  );
}
