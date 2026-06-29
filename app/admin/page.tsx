// app/admin/page.tsx — Dashboard (placeholder w Fazie 1).
// Karty szybkich akcji + miejsca na "Leady w toku" i "Ostatnia aktywność".
import Link from "next/link";
import { FileText, UserPlus, CheckSquare, BarChart3 } from "lucide-react";
import { tokens } from "@/lib/theme";

const ACTIONS = [
  { label: "New Form", icon: FileText, href: "/admin/forms" },
  { label: "New Contact", icon: UserPlus, href: "/admin/pipeline" },
  { label: "New Task", icon: CheckSquare, href: "/admin/tasks" },
  { label: "Analytics", icon: BarChart3, href: "/admin/analytics" },
];

export default function DashboardPage() {
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 26, fontWeight: 700 }}>Dashboard</h1>
      <p style={{ margin: "0 0 24px", color: tokens.muted, fontSize: 14 }}>
        Przegląd Twojego pipeline’u i ostatnich zdarzeń.
      </p>

      {/* Karty szybkich akcji */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 16,
          marginBottom: 28,
        }}
      >
        {ACTIONS.map(({ label, icon: Icon, href }) => (
          <Link key={label} href={href} style={actionCardStyle}>
            <span
              style={{
                width: 38,
                height: 38,
                borderRadius: 11,
                background: tokens.accentSoft,
                color: tokens.accent,
                display: "grid",
                placeItems: "center",
              }}
            >
              <Icon size={20} />
            </span>
            <span style={{ fontSize: 15, fontWeight: 600 }}>{label}</span>
          </Link>
        ))}
      </div>

      {/* Placeholdery dwóch sekcji */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
        }}
      >
        <Placeholder title="Leads in progress" hint="Wkrótce: kontakty spoza etapów Won/Lost." />
        <Placeholder title="Recent activity" hint="Wkrótce: oś czasu ostatnich zdarzeń." />
      </div>
    </div>
  );
}

function Placeholder({ title, hint }: { title: string; hint: string }) {
  return (
    <section style={cardStyle}>
      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>{title}</div>
      <div
        style={{
          color: tokens.muted,
          fontSize: 14,
          padding: "28px 0",
          textAlign: "center",
        }}
      >
        {hint}
      </div>
    </section>
  );
}

const cardStyle: React.CSSProperties = {
  background: tokens.card,
  border: `1px solid ${tokens.border}`,
  borderRadius: tokens.radius,
  padding: 20,
};

const actionCardStyle: React.CSSProperties = {
  ...cardStyle,
  display: "flex",
  alignItems: "center",
  gap: 12,
  textDecoration: "none",
  color: tokens.text,
};
