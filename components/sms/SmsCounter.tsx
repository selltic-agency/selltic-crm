// components/sms/SmsCounter.tsx — licznik znaków/segmentów/kodowania SMS na żywo.
// Używa czystego lib/sms/encoding (bez tokenu) — bezpieczny na kliencie.
"use client";

import { tokens } from "@/lib/ui";
import { segmentInfo } from "@/lib/sms/encoding";

// Przybliżony koszt w punktach na segment (SMSAPI). Realny koszt wraca z bramki
// po wysyłce (cost_points); tu pokazujemy tylko szacunek do kompozytora.
const POINTS_PER_SEGMENT = 0.16;

export function SmsCounter({ text }: { text: string }) {
  const info = segmentInfo(text);
  const encodingLabel = info.encoding === "ucs2" ? "Unicode (UCS-2)" : "GSM-7";
  const estPoints = (info.segments * POINTS_PER_SEGMENT).toFixed(2);
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        alignItems: "center",
        fontSize: 12,
        color: tokens.muted,
      }}
    >
      <span>
        <b style={{ color: tokens.text }}>{info.length}</b> / {info.perSegment} znaków
      </span>
      <span>·</span>
      <span>
        <b style={{ color: info.segments > 1 ? tokens.warning : tokens.text }}>{info.segments}</b>{" "}
        {segmentWord(info.segments)}
      </span>
      <span>·</span>
      <span
        style={{
          padding: "1px 8px",
          borderRadius: 999,
          background: info.encoding === "ucs2" ? "rgba(242,153,74,0.14)" : tokens.accentSoft,
          color: info.encoding === "ucs2" ? tokens.warning : tokens.accent,
          fontWeight: 600,
        }}
      >
        {encodingLabel}
      </span>
      <span>·</span>
      <span>szac. koszt ≈ {estPoints} pkt</span>
    </div>
  );
}

function segmentWord(n: number): string {
  if (n === 1) return "segment";
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "segmenty";
  return "segmentów";
}
