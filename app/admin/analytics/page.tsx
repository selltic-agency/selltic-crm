// app/admin/analytics/page.tsx — analityka na realnych danych.
// KPI (kontakty, konwersja, wygrane, wartość) + wykresy:
//   • obszarowy: zgłoszenia / dzień (ostatnie 7 dni)
//   • słupkowy: liczba kontaktów wg etapu
//   • kołowy: liczba kontaktów wg źródła
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Users,
  TrendingUp,
  Trophy,
  Wallet,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import { tokens, formatPLN } from "@/lib/ui";
import { type Contact } from "@/lib/types";
import { useStages } from "@/lib/stages";

type Kpis = {
  contacts: number;
  conversion: number; // %
  won: number;
  wonValue: number;
};

const SOURCE_COLORS = [
  tokens.accent,
  "#1A73E7",
  "#F2994A",
  "#18A957",
  "#E5484D",
  "#00B8A9",
  "#8A92A6",
];

export default function AnalyticsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { stages } = useStages();
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<Kpis>({ contacts: 0, conversion: 0, won: 0, wonValue: 0 });
  const [perDay, setPerDay] = useState<{ label: string; value: number }[]>([]);
  const [perStage, setPerStage] = useState<{ label: string; value: number; color: string }[]>([]);
  const [perSource, setPerSource] = useState<{ label: string; value: number }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);

    // Ostatnie 7 dni (włącznie z dziś) — granica zapytania o zgłoszenia.
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - 6);

    const [contactsRes, subsRes] = await Promise.all([
      supabase.from("contacts").select("stage, value, source"),
      supabase
        .from("submissions")
        .select("created_at")
        .gte("created_at", since.toISOString()),
    ]);

    const contacts = (contactsRes.data as Pick<Contact, "stage" | "value" | "source">[]) ?? [];
    const subs = (subsRes.data as { created_at: string }[]) ?? [];

    // ── KPI ──────────────────────────────────────────────────────────────
    const total = contacts.length;
    const wonKeys = stages.filter((s) => s.is_won).map((s) => s.key);
    const won = contacts.filter((c) => wonKeys.includes(c.stage));
    const wonValue = won.reduce((sum, c) => sum + Number(c.value || 0), 0);
    setKpis({
      contacts: total,
      conversion: total ? Math.round((won.length / total) * 100) : 0,
      won: won.length,
      wonValue,
    });

    // ── Zgłoszenia / dzień (7 dni) ───────────────────────────────────────
    const days: { label: string; value: number }[] = [];
    const byDay = new Map<string, number>();
    for (const s of subs) {
      const key = new Date(s.created_at).toLocaleDateString("pl-PL");
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString("pl-PL");
      days.push({
        label: d.toLocaleDateString("pl-PL", { day: "2-digit", month: "short" }),
        value: byDay.get(key) ?? 0,
      });
    }
    setPerDay(days);

    // ── Kontakty wg etapu ────────────────────────────────────────────────
    setPerStage(
      stages.map((s) => ({
        label: s.label,
        value: contacts.filter((c) => c.stage === s.key).length,
        color: s.color,
      }))
    );

    // ── Kontakty wg źródła ───────────────────────────────────────────────
    const bySource = new Map<string, number>();
    for (const c of contacts) {
      const key = c.source || "Bezpośrednio";
      bySource.set(key, (bySource.get(key) ?? 0) + 1);
    }
    setPerSource(
      [...bySource.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value)
    );

    setLoading(false);
  }, [supabase, stages]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 20px" }}>Analityka</h1>

      {/* KPI */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <Kpi icon={Users} label="Kontakty" value={loading ? null : String(kpis.contacts)} />
        <Kpi icon={TrendingUp} label="Konwersja" value={loading ? null : `${kpis.conversion}%`} />
        <Kpi icon={Trophy} label="Wygrane" value={loading ? null : String(kpis.won)} />
        <Kpi icon={Wallet} label="Wartość wygranych" value={loading ? null : formatPLN(kpis.wonValue)} />
      </div>

      {/* Zgłoszenia / dzień */}
      <ChartCard title="Zgłoszenia (ostatnie 7 dni)">
        {loading ? (
          <ChartSkeleton />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={perDay} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="sub-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={tokens.accent} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={tokens.accent} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={tokens.border} vertical={false} />
              <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} width={32} />
              <Tooltip {...tooltipProps} />
              <Area
                type="monotone"
                dataKey="value"
                name="Zgłoszenia"
                stroke={tokens.accent}
                strokeWidth={2.5}
                fill="url(#sub-fill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 18,
          marginTop: 18,
        }}
      >
        {/* Kontakty wg etapu */}
        <ChartCard title="Kontakty wg etapu">
          {loading ? (
            <ChartSkeleton />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={perStage} margin={{ top: 10, right: 10, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={tokens.border} vertical={false} />
                <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={axisTick} axisLine={false} tickLine={false} width={32} />
                <Tooltip {...tooltipProps} cursor={{ fill: tokens.accentSoft }} />
                <Bar dataKey="value" name="Kontakty" radius={[8, 8, 0, 0]}>
                  {perStage.map((s) => (
                    <Cell key={s.label} fill={s.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Kontakty wg źródła */}
        <ChartCard title="Kontakty wg źródła">
          {loading ? (
            <ChartSkeleton />
          ) : perSource.length === 0 ? (
            <Empty>Brak danych o źródłach.</Empty>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <ResponsiveContainer width="60%" height={220} minWidth={180}>
                <PieChart>
                  <Pie
                    data={perSource}
                    dataKey="value"
                    nameKey="label"
                    innerRadius={52}
                    outerRadius={88}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {perSource.map((s, i) => (
                      <Cell key={s.label} fill={SOURCE_COLORS[i % SOURCE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip {...tooltipProps} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ flex: 1, minWidth: 120, display: "grid", gap: 8 }}>
                {perSource.map((s, i) => (
                  <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 3,
                        background: SOURCE_COLORS[i % SOURCE_COLORS.length],
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ flex: 1, color: tokens.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.label}
                    </span>
                    <span style={{ fontWeight: 600 }}>{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

const axisTick = { fontSize: 12, fill: tokens.muted };
const tooltipProps = {
  contentStyle: {
    borderRadius: 10,
    border: `1px solid ${tokens.border}`,
    fontSize: 13,
    boxShadow: "0 8px 30px rgba(15,18,28,0.12)",
  },
  cursor: { stroke: tokens.border },
};

function Kpi({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users;
  label: string;
  value: string | null;
}) {
  return (
    <div
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        padding: 18,
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      <span
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          background: tokens.accentSoft,
          color: tokens.accent,
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
      >
        <Icon size={22} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: tokens.muted, fontWeight: 600 }}>{label}</div>
        {value === null ? (
          <div
            style={{
              height: 22,
              width: 64,
              marginTop: 4,
              borderRadius: 6,
              background: tokens.bg,
              animation: "selltic-pulse 1.2s ease-in-out infinite",
            }}
          />
        ) : (
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 2 }}>{value}</div>
        )}
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: tokens.card,
        border: `1px solid ${tokens.border}`,
        borderRadius: tokens.radius,
        padding: 18,
      }}
    >
      <h2 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 14px" }}>{title}</h2>
      <style>{`@keyframes selltic-pulse { 0%,100%{opacity:1} 50%{opacity:.45} }`}</style>
      {children}
    </section>
  );
}

function ChartSkeleton() {
  return (
    <div
      style={{
        height: 240,
        borderRadius: 12,
        background: tokens.bg,
        animation: "selltic-pulse 1.2s ease-in-out infinite",
      }}
    />
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: 220, display: "grid", placeItems: "center", color: tokens.muted, fontSize: 14 }}>
      {children}
    </div>
  );
}
