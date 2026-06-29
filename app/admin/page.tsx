// app/admin/page.tsx — Dashboard: szybkie akcje + leady w toku (realne dane).
import Link from "next/link";
import { redirect } from "next/navigation";
import { FileText, UserPlus, CheckSquare, BarChart3 } from "lucide-react";
import { createSupabaseServer } from "@/lib/supabase/server";
import { formatPLN, tokens } from "@/lib/design";
import { stageById, type Contact } from "@/lib/types";

export const dynamic = "force-dynamic";

const QUICK = [
  { href: "/admin/forms", label: "Nowy formularz", icon: FileText },
  { href: "/admin/pipeline", label: "Nowy kontakt", icon: UserPlus },
  { href: "/admin/tasks", label: "Nowe zadanie", icon: CheckSquare },
  { href: "/admin/analytics", label: "Analityka", icon: BarChart3 },
];

export default async function DashboardPage() {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Leady w toku = wszystko poza wygranymi/przegranymi.
  const { data: contacts } = await supabase
    .from("contacts")
    .select("*")
    .eq("owner", user.id)
    .not("stage", "in", "(won,lost)")
    .order("updated_at", { ascending: false })
    .limit(20);

  const leads = (contacts ?? []) as Contact[];

  return (
    <div>
      <h1 style={{ margin: "0 0 22px", fontSize: 24, fontWeight: 700 }}>Dashboard</h1>

      {/* Szybkie akcje */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 14,
          marginBottom: 26,
        }}
      >
        {QUICK.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="card-hover"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: 18,
              background: tokens.card,
              border: `1px solid ${tokens.border}`,
              borderRadius: 16,
              textDecoration: "none",
              color: tokens.text,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 11,
                background: tokens.accentSoft,
                color: tokens.accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon size={20} />
            </div>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{label}</span>
          </Link>
        ))}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)",
          gap: 16,
        }}
      >
        {/* Leady w toku */}
        <Card title="Leady w toku">
          {leads.length === 0 ? (
            <Empty>Brak leadów w toku.</Empty>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
              <thead>
                <tr style={{ textAlign: "left", color: tokens.muted }}>
                  <Th>Nazwa</Th>
                  <Th>Firma</Th>
                  <Th>Etap</Th>
                  <Th style={{ textAlign: "right" }}>Wartość</Th>
                </tr>
              </thead>
              <tbody>
                {leads.map((c) => {
                  const stage = stageById(c.stage);
                  return (
                    <tr key={c.id} style={{ borderTop: `1px solid ${tokens.border}` }}>
                      <Td style={{ fontWeight: 600 }}>{c.name || "Bez nazwy"}</Td>
                      <Td style={{ color: tokens.muted }}>{c.company || "—"}</Td>
                      <Td>
                        <span
                          style={{
                            fontSize: 11.5,
                            fontWeight: 600,
                            padding: "3px 9px",
                            borderRadius: 999,
                            background: `${stage.color}1a`,
                            color: stage.color,
                          }}
                        >
                          {stage.label}
                        </span>
                      </Td>
                      <Td style={{ textAlign: "right", fontWeight: 600 }}>
                        {c.value > 0 ? formatPLN(c.value) : "—"}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        {/* Ostatnia aktywność — pełni funkcję w fazie analityki */}
        <Card title="Ostatnia aktywność">
          <Empty>Kanał aktywności pojawi się wkrótce.</Empty>
        </Card>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "14px 18px",
          borderBottom: `1px solid ${tokens.border}`,
          fontWeight: 700,
          fontSize: 14,
        }}
      >
        {title}
      </div>
      <div style={{ padding: 18 }}>{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, color: tokens.muted, fontSize: 13.5 }}>{children}</p>;
}

function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th style={{ padding: "6px 8px", fontWeight: 600, fontSize: 12, ...style }}>{children}</th>
  );
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: "10px 8px", ...style }}>{children}</td>;
}
