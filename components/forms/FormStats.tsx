// components/forms/FormStats.tsx — §5. Zakładka „Statystyki” edytora formularza.
// Cztery kafelki metryk + lejek krokowy (Recharts, poziome słupki) z procentem
// odpływu między krokami. Największy pojedynczy odpływ podświetlony marką (#E8194B).
// Zakres dat: 7 / 30 / 90 dni / cały czas.
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Cell, ResponsiveContainer, Tooltip,
} from "recharts";
import { Eye, Users, CheckCircle2, Percent } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tokens } from "@/lib/ui";
import type { FormSchema, Step } from "@/lib/forms";
import { stepFields } from "@/lib/forms";

const BRAND_RED = "#E8194B";

type Range = 7 | 30 | 90 | 0; // 0 = cały czas

type FunnelRow = { step_index: number; reached: number };
type Stats = {
  views: number;
  unique_users: number;
  completions: number;
  abandoned: number;
  last_submission: string | null;
  funnel: FunnelRow[];
};

export default function FormStats({ formId }: { formId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [range, setRange] = useState<Range>(30);
  const [stats, setStats] = useState<Stats | null>(null);
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("forms").select("published, schema").eq("id", formId).single().then(({ data }) => {
      setSchema(((data?.published ?? data?.schema) as FormSchema) ?? null);
    });
  }, [supabase, formId]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    const since = range === 0 ? null : new Date(Date.now() - range * 86400_000).toISOString();
    const { data, error } = await supabase.rpc("form_stats", { p_form_id: formId, p_since: since });
    if (error) setErr("Nie udało się wczytać statystyk.");
    else setStats(data as Stats);
    setLoading(false);
  }, [supabase, formId, range]);

  useEffect(() => { load(); }, [load]);

  // Etykieta kroku po indeksie (z bieżącego/opublikowanego schematu).
  const stepLabel = useCallback(
    (index: number): string => {
      const steps = (schema?.steps ?? []) as Step[];
      const s = steps[index];
      if (!s) return `Krok ${index + 1}`;
      const q = s.question?.trim() || stepFields(s)[0]?.question?.trim();
      return q ? q : `Krok ${index + 1}`;
    },
    [schema]
  );

  const conversion = stats && stats.unique_users > 0
    ? (stats.completions / stats.unique_users) * 100
    : null;

  // Dane lejka. `reached` = ilu UNIKALNYCH użytkowników dotarło do danego kroku
  // (kumulacyjnie, monotonicznie malejąco). Odpływ = różnica względem kroku
  // poprzedniego. Największy pojedynczy odpływ podświetlamy marką.
  const funnel = useMemo(() => {
    const rows = (stats?.funnel ?? []).slice().sort((a, b) => a.step_index - b.step_index);
    const top = rows[0]?.reached ?? 0;
    const withDrop = rows.map((r, i) => {
      const prev = rows[i - 1];
      const dropOff = prev ? Math.max(0, prev.reached - r.reached) : 0;
      const dropPct = prev && prev.reached > 0 ? (dropOff / prev.reached) * 100 : 0;
      // % zachowanych względem pierwszego kroku (widoczności formularza).
      const keepPct = top > 0 ? (r.reached / top) * 100 : 0;
      return { ...r, label: `${r.step_index + 1}. ${stepLabel(r.step_index)}`, dropOff, dropPct, keepPct };
    });
    let maxIdx = -1, maxDrop = -1;
    withDrop.forEach((r, i) => { if (r.dropOff > maxDrop) { maxDrop = r.dropOff; maxIdx = i; } });
    return { rows: withDrop, maxIdx };
  }, [stats, stepLabel]);

  return (
    <div>
      {/* Zakres dat */}
      <div style={{ display: "flex", gap: 6, marginBottom: 18, flexWrap: "wrap" }}>
        {([7, 30, 90, 0] as Range[]).map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            style={{
              padding: "6px 14px", borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${range === r ? tokens.accent : tokens.border}`,
              background: range === r ? tokens.accentSoft : "#fff",
              color: range === r ? tokens.accent : tokens.muted,
            }}
          >
            {r === 0 ? "Cały czas" : `${r} dni`}
          </button>
        ))}
      </div>

      {err && <p style={{ color: tokens.danger }}>{err}</p>}
      {loading && !stats ? (
        <p style={{ color: tokens.muted }}>Wczytywanie…</p>
      ) : (
        <>
          {/* Cztery kafelki */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 22 }}>
            <Tile icon={<Eye size={16} />} label="Wyświetlenia" value={stats?.views ?? 0} />
            <Tile icon={<Users size={16} />} label="Unikalni użytkownicy" value={stats?.unique_users ?? 0} />
            <Tile icon={<CheckCircle2 size={16} />} label="Zgłoszenia" value={stats?.completions ?? 0} />
            <Tile icon={<Percent size={16} />} label="Konwersja" value={conversion == null ? "—" : `${conversion.toFixed(1)}%`} />
          </div>

          {/* Lejek krokowy */}
          <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: 16, padding: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Lejek krokowy</h3>
              <span style={{ fontSize: 12, color: tokens.muted }}>
                <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: BRAND_RED, marginRight: 6, verticalAlign: "middle" }} />
                największy odpływ
              </span>
            </div>

            {funnel.rows.length === 0 ? (
              <p style={{ color: tokens.muted, fontSize: 14, margin: 0 }}>Brak danych lejka w wybranym zakresie.</p>
            ) : (
              <>
                <div style={{ width: "100%", height: Math.max(160, funnel.rows.length * 46) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={funnel.rows} margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                      <XAxis type="number" hide />
                      <YAxis
                        type="category"
                        dataKey="label"
                        width={200}
                        tick={{ fontSize: 12, fill: tokens.text }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: tokens.bg }}
                        formatter={(v: number, n: string) => [`${v} os.`, n === "reached" ? "Dotarło" : n]}
                        labelStyle={{ fontWeight: 600 }}
                        contentStyle={{ borderRadius: 10, border: `1px solid ${tokens.border}`, fontSize: 12 }}
                      />
                      <Bar dataKey="reached" radius={[0, 6, 6, 0]} barSize={22}>
                        {funnel.rows.map((_, i) => (
                          <Cell key={i} fill={i === funnel.maxIdx ? BRAND_RED : tokens.accent} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Ile osób dotarło do każdego kroku + odpływ względem poprzedniego */}
                <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
                  {funnel.rows.map((r, i) => (
                    <div key={r.step_index} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12.5, color: tokens.muted }}>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        Krok {r.step_index + 1}: dotarło <b style={{ color: tokens.text }}>{r.reached}</b>{" "}
                        {i === 0 ? "os. (100%)" : `os. (${r.keepPct.toFixed(0)}% wejść)`}
                      </span>
                      {i > 0 && r.dropOff > 0 && (
                        <span style={{ flexShrink: 0, fontWeight: 700, color: i === funnel.maxIdx ? BRAND_RED : tokens.text }}>
                          −{r.dropOff} os. (−{r.dropPct.toFixed(0)}%)
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <div style={{ background: tokens.card, border: `1px solid ${tokens.border}`, borderRadius: 14, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: tokens.muted, fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>
        {icon}{label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {typeof value === "number" ? value.toLocaleString("pl-PL") : value}
      </div>
    </div>
  );
}
