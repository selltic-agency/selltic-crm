// app/admin/forms/share-modal.tsx — modal „Udostępnij” dla opublikowanego formularza.
// Pokazuje publiczny link oraz gotowy kod osadzenia (iframe + auto-resize).
"use client";

import { useEffect, useMemo, useState } from "react";
import { tokens } from "@/lib/ui";
import { publicFormUrl } from "@/lib/publicUrl";
import MIcon from "@/components/MaterialIcon";
import { useScrollLock } from "@/lib/useScrollLock";

type Props = {
  slug: string;
  title: string | null;
  onClose: () => void;
};

export default function ShareModal({ slug, title, onClose }: Props) {
  useScrollLock();
  // origin znamy dopiero w przeglądarce.
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<"link" | "embed" | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Zamknięcie klawiszem Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Publiczny link: dedykowana subdomena (np. go.selltic-agency.pl/<slug>),
  // a gdy nie skonfigurowano — <origin>/f/<slug>.
  const publicUrl = publicFormUrl(slug, origin);
  const iframeId = `selltic-form-${slug}`;

  const embedCode = useMemo(
    () =>
      `<iframe id="${iframeId}" src="${publicUrl}?embed=1"
  style="width:100%;border:0;min-height:600px" title="${title || "Formularz"}" loading="lazy"></iframe>
<script>
  window.addEventListener("message", function (e) {
    if (e.data && e.data.type === "selltic-form" && e.data.formHeight) {
      var f = document.getElementById("${iframeId}");
      if (f) f.style.height = e.data.formHeight + "px";
    }
  });
</script>`,
    [iframeId, publicUrl, title]
  );

  async function copy(text: string, which: "link" | "embed") {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback dla starszych przeglądarek / braku uprawnień.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(which);
    setTimeout(() => setCopied((c) => (c === which ? null : c)), 1600);
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(20,22,30,0.45)",
        display: "grid",
        placeItems: "center",
        zIndex: 50,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: tokens.card,
          borderRadius: tokens.radius,
          border: `1px solid ${tokens.border}`,
          width: "100%",
          maxWidth: 540,
          padding: 22,
          boxShadow: "0 24px 60px rgba(20,22,30,0.25)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Udostępnij formularz</h2>
          <button
            onClick={onClose}
            aria-label="Zamknij"
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              border: `1px solid ${tokens.border}`,
              background: "#fff",
              display: "grid",
              placeItems: "center",
              cursor: "pointer",
            }}
          >
            <MIcon name="close" size={16} color={tokens.muted} />
          </button>
        </div>

        {/* Publiczny link */}
        <label style={labelStyle}>Publiczny link</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <input readOnly value={publicUrl} style={readonlyInput} onFocus={(e) => e.currentTarget.select()} />
          <CopyBtn active={copied === "link"} onClick={() => copy(publicUrl, "link")} />
          <a
            href={publicUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Otwórz"
            style={{ ...iconBtn, display: "grid", placeItems: "center", color: tokens.muted, textDecoration: "none" }}
          >
            <MIcon name="open_in_new" size={16} />
          </a>
        </div>

        {/* Kod osadzenia */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <label style={{ ...labelStyle, marginBottom: 0 }}>Kod osadzenia (iframe)</label>
          <CopyBtn active={copied === "embed"} onClick={() => copy(embedCode, "embed")} withLabel />
        </div>
        <textarea
          readOnly
          value={embedCode}
          rows={9}
          onFocus={(e) => e.currentTarget.select()}
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "12px 14px",
            border: `1px solid ${tokens.border}`,
            borderRadius: 12,
            fontSize: 12.5,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            color: tokens.text,
            background: tokens.bg,
            resize: "vertical",
            lineHeight: 1.5,
          }}
        />
        <p style={{ fontSize: 12, color: tokens.muted, margin: "10px 0 0" }}>
          Wklej kod na dowolnej stronie (Framer, WordPress, HTML). Ramka sama dopasuje wysokość.
        </p>
      </div>
    </div>
  );
}

function CopyBtn({ active, onClick, withLabel }: { active: boolean; onClick: () => void; withLabel?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...iconBtn,
        width: withLabel ? "auto" : 40,
        padding: withLabel ? "6px 12px" : 0,
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: active ? tokens.success : tokens.text,
        fontSize: 13,
        fontWeight: 600,
      }}
      aria-label="Kopiuj"
    >
      {active ? <MIcon name="check" size={15} /> : <MIcon name="content_copy" size={15} />}
      {withLabel && (active ? "Skopiowano" : "Kopiuj")}
    </button>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: tokens.muted,
  marginBottom: 6,
};

const readonlyInput: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  boxSizing: "border-box",
  padding: "10px 12px",
  border: `1px solid ${tokens.border}`,
  borderRadius: 10,
  fontSize: 13,
  color: tokens.text,
  background: tokens.bg,
  outline: "none",
};

const iconBtn: React.CSSProperties = {
  height: 40,
  borderRadius: 10,
  border: `1px solid ${tokens.border}`,
  background: "#fff",
  cursor: "pointer",
  flexShrink: 0,
};
