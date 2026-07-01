// components/prospecting/ProspectCard.tsx — karta prospektu w widoku listy.
"use client";

import { Star, Phone, Globe, ArrowRight, Ban } from "lucide-react";
import { tokens } from "@/lib/ui";
import type { Prospect } from "@/lib/types";
import { ScoreBadge } from "@/components/ScoreBreakdown";
import {
  STATUS_COLOR,
  toDisplayStatus,
  isClosedBusiness,
  scoreLabel,
  initials,
} from "@/lib/prospectStatus";

function domainFromUrl(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function ProspectCard({
  prospect,
  onOpen,
  onConvert,
}: {
  prospect: Prospect;
  onOpen: () => void;
  onConvert: () => void;
}) {
  const p = prospect;
  const display = toDisplayStatus(p.prospecting_status);
  const closed = isClosedBusiness(p);
  const statusColor = STATUS_COLOR[display];

  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        padding: "16px 18px",
        cursor: "pointer",
        opacity: closed ? 0.55 : 1,
        transition: `box-shadow .15s ${tokens.ease}, border-color .15s ${tokens.ease}`,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 6px 20px rgba(15,18,28,0.08)")}
      onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
    >
      {/* Awatar z inicjałami */}
      <div
        style={{
          width: 46,
          height: 46,
          borderRadius: 12,
          flexShrink: 0,
          background: `${statusColor}1A`,
          color: statusColor,
          display: "grid",
          placeItems: "center",
          fontWeight: 800,
          fontSize: 15,
        }}
      >
        {initials(p.name)}
      </div>

      {/* Nazwa + branża/miasto + tagi */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: tokens.text }}>{p.name}</span>
          {closed && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 8px",
                borderRadius: 999,
                background: `${tokens.danger}1A`,
                color: tokens.danger,
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Ban size={11} /> Firma zamknięta
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: tokens.muted, marginTop: 2 }}>
          {[p.industry, p.city].filter(Boolean).join(" · ") || "—"}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
          {p.website ? (
            <Tag icon={<Globe size={11} />} color={tokens.muted} bg={tokens.bg}>
              {domainFromUrl(p.website)}
            </Tag>
          ) : (
            <Tag color={tokens.success} bg={`${tokens.success}1A`}>
              Brak strony
            </Tag>
          )}
          {p.rating != null && (
            <Tag icon={<Star size={11} fill={tokens.warning} color={tokens.warning} />} color={tokens.text} bg={tokens.bg}>
              {p.rating.toFixed(1)} ({p.review_count ?? 0})
            </Tag>
          )}
          {p.phone && (
            <Tag icon={<Phone size={11} />} color={tokens.text} bg={tokens.bg}>
              {p.phone}
            </Tag>
          )}
        </div>
      </div>

      {/* Score + akcja */}
      <div
        style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10, flexShrink: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        {p.lead_score != null && (
          <div style={{ textAlign: "right" }}>
            <ScoreBadge score={p.lead_score} breakdown={p.lead_score_breakdown} fallbackReasons={p.props?.score_reasons} fontSize={13} />
            <div style={{ fontSize: 11, color: tokens.muted, marginTop: 3, textTransform: "uppercase", fontWeight: 700 }}>
              {scoreLabel(p.lead_score)}
            </div>
          </div>
        )}

        {display === "converted" ? (
          p.converted_deal_id ? (
            <a
              href={`/admin/leads/${p.converted_deal_id}`}
              onClick={(e) => e.stopPropagation()}
              style={{ fontSize: 13, fontWeight: 700, color: tokens.success, whiteSpace: "nowrap" }}
            >
              ✅ Zobacz deal
            </a>
          ) : (
            <span style={{ fontSize: 13, fontWeight: 700, color: tokens.success }}>✅ Skonwertowany</span>
          )
        ) : !closed && display !== "not_interested" ? (
          <button
            onClick={onConvert}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 10,
              border: "none",
              background: tokens.success,
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Konwertuj na lead <ArrowRight size={14} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Tag({
  children,
  icon,
  color,
  bg,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  color: string;
  bg: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 12,
        fontWeight: 600,
        padding: "3px 9px",
        borderRadius: 999,
        background: bg,
        color,
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      {children}
    </span>
  );
}
