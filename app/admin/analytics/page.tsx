// app/admin/analytics/page.tsx — placeholder analityki.
// Pełne wykresy (KPI, zgłoszenia/dzień, leady wg etapu/źródła) powstają
// w kolejnej fazie. Ta strona zapobiega błędowi 404 z nawigacji „Analityka”.
import { BarChart3 } from "lucide-react";
import { tokens } from "@/lib/ui";

export default function AnalyticsPage() {
  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 20px" }}>Analityka</h1>

      <div
        style={{
          background: tokens.card,
          border: `1px dashed ${tokens.border}`,
          borderRadius: tokens.radius,
          padding: "48px 24px",
          textAlign: "center",
          color: tokens.muted,
          maxWidth: 560,
        }}
      >
        <span
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            background: tokens.accentSoft,
            color: tokens.accent,
            display: "grid",
            placeItems: "center",
            margin: "0 auto 14px",
          }}
        >
          <BarChart3 size={26} />
        </span>
        <p style={{ fontSize: 16, fontWeight: 600, color: tokens.text, margin: "0 0 6px" }}>
          Analityka już wkrótce
        </p>
        <p style={{ fontSize: 14, margin: 0, lineHeight: 1.5 }}>
          Wskaźniki konwersji, wykres zgłoszeń oraz podział leadów wg etapu i
          źródła pojawią się w kolejnej fazie. Na razie aktualne dane znajdziesz
          w Lejku i na Pulpicie.
        </p>
      </div>
    </div>
  );
}
