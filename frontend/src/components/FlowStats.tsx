import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import { getFlowStats } from "../api";

// ── types ──────────────────────────────────────────────────────────────────────

interface Summary {
  total_premium: number;
  total_count:   number;
  call_count:    number;
  put_count:     number;
  sweep_count:   number;
  call_pct:      number;
  put_pct:       number;
  sweep_pct:     number;
  avg_score:     number;
}

interface SymbolRow {
  symbol:        string;
  total_premium: number;
  count:         number;
  calls:         number;
  puts:          number;
  sweeps:        number;
  avg_score:     number;
  max_single:    number;
  call_pct:      number;
}

interface HourBucket {
  hour:    string;
  premium: number;
  count:   number;
  sweeps:  number;
}

interface TopTrade {
  id:                 number;
  symbol:             string;
  option_type:        string;
  strike:             number;
  expiry:             string;
  premium:            number;
  size:               number;
  price:              number;
  is_sweep:           boolean;
  flow_score:         number;
  implied_volatility: number;
  detected_at:        string;
}

interface StatsData {
  hours:         number;
  min_score:     number;
  summary:       Summary;
  symbol_totals: SymbolRow[];
  hourly:        HourBucket[];
  top_trades:    TopTrade[];
}

interface Props {
  hours:    number;
  minScore: number;
}

// ── formatting ─────────────────────────────────────────────────────────────────

function fmtP(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

// recharts colors (can't use Tailwind inside SVG)
const C = {
  bull:   "#3fb950",
  bear:   "#f85149",
  gold:   "#d29922",
  accent: "#58a6ff",
  grid:   "#1c2128",
  muted:  "#484f58",
  dim:    "#8b949e",
  panel2: "#111820",
};

// ── summary cards ──────────────────────────────────────────────────────────────

function SummaryCards({ s }: { s: Summary }) {
  const metrics = [
    { label: "TOTAL PREMIUM", value: fmtP(s.total_premium),             color: "text-bright" },
    { label: "TRADES",        value: s.total_count.toLocaleString(),     color: "text-bright" },
    { label: "CALLS",         value: `${s.call_pct}%`,                  color: "text-bull"   },
    { label: "PUTS",          value: `${s.put_pct}%`,                   color: "text-bear"   },
    { label: "SWEEPS",        value: `${s.sweep_pct}% (${s.sweep_count})`, color: "text-gold" },
    { label: "AVG SCORE",     value: s.avg_score.toFixed(1),             color: "text-dim"    },
  ];

  return (
    <div className="shrink-0 flex gap-6 px-4 py-3 border-b border-border bg-panel flex-wrap">
      {metrics.map(({ label, value, color }) => (
        <div key={label} className="flex flex-col gap-0.5">
          <span className="text-[9px] text-muted tracking-widest uppercase">{label}</span>
          <span className={`text-sm font-semibold tabular-nums ${color}`}>{value}</span>
        </div>
      ))}
    </div>
  );
}

// ── call/put mini bar ──────────────────────────────────────────────────────────

function CpBar({ callPct }: { callPct: number }) {
  return (
    <div className="flex h-2 w-20 rounded overflow-hidden gap-px">
      <div className="bg-bull/60 rounded-l" style={{ width: `${callPct}%` }} />
      <div className="bg-bear/60 rounded-r flex-1" />
    </div>
  );
}

// ── symbol leaderboard ─────────────────────────────────────────────────────────

function Leaderboard({ rows }: { rows: SymbolRow[] }) {
  if (!rows.length) return (
    <div className="flex items-center justify-center h-32 text-muted text-[11px]">
      No flow data in this window
    </div>
  );

  const maxPremium = rows[0]?.total_premium ?? 1;

  return (
    <div className="flex-1 overflow-y-auto">
      {/* headers */}
      <div className="flex items-center text-[9px] text-muted uppercase tracking-wide
                      border-b border-border px-3 py-1 bg-panel2 sticky top-0 z-10">
        <div className="w-[72px] shrink-0">Symbol</div>
        <div className="flex-1">Premium bar</div>
        <div className="w-[80px] shrink-0 text-right">Total $</div>
        <div className="w-[44px] shrink-0 text-right">Trades</div>
        <div className="w-[88px] shrink-0 text-center">C / P</div>
        <div className="w-[44px] shrink-0 text-right">Swp</div>
        <div className="w-[48px] shrink-0 text-right">AvgΣ</div>
      </div>

      {rows.map((r, i) => {
        const barPct = (r.total_premium / maxPremium) * 100;
        const callBull = r.call_pct >= 60;
        const putBear  = r.call_pct <= 40;

        return (
          <div key={r.symbol}
            className="flex items-center text-[11px] tabular-nums border-b border-border
                       hover:bg-panel2/60 transition-colors px-3 py-[5px]">

            {/* rank + symbol */}
            <div className="w-[72px] shrink-0 flex items-center gap-2">
              <span className="text-muted text-[10px] w-4 text-right">{i + 1}</span>
              <span className="font-bold text-bright">{r.symbol}</span>
            </div>

            {/* premium bar */}
            <div className="flex-1 pr-3">
              <div className="h-2 rounded overflow-hidden bg-border">
                <div
                  className={`h-full rounded transition-all ${
                    callBull ? "bg-bull/50" : putBear ? "bg-bear/50" : "bg-accent/50"
                  }`}
                  style={{ width: `${barPct}%` }}
                />
              </div>
            </div>

            {/* total premium */}
            <div className="w-[80px] shrink-0 text-right font-semibold text-bright">
              {fmtP(r.total_premium)}
            </div>

            {/* trade count */}
            <div className="w-[44px] shrink-0 text-right text-dim">{r.count}</div>

            {/* call/put breakdown */}
            <div className="w-[88px] shrink-0 flex items-center justify-center gap-1">
              <span className="text-bull">{r.calls}</span>
              <span className="text-muted">/</span>
              <span className="text-bear">{r.puts}</span>
              <CpBar callPct={r.call_pct} />
            </div>

            {/* sweeps */}
            <div className={`w-[44px] shrink-0 text-right ${r.sweeps > 0 ? "text-gold" : "text-muted"}`}>
              {r.sweeps || "—"}
            </div>

            {/* avg score */}
            <div className={`w-[48px] shrink-0 text-right font-semibold
              ${r.avg_score >= 9 ? "text-extreme"
              : r.avg_score >= 6 ? "text-gold"
              : r.avg_score >= 3 ? "text-bull"
              : "text-muted"}`}>
              {r.avg_score.toFixed(1)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── hourly chart ───────────────────────────────────────────────────────────────

interface HourTooltipProps {
  active?:  boolean;
  payload?: { payload: HourBucket }[];
}
function HourTooltip({ active, payload }: HourTooltipProps) {
  if (!active || !payload?.length) return null;
  const b = payload[0].payload;
  // convert UTC hour to ET (approximate: UTC-4 EDT / UTC-5 EST; use -4 for market hours)
  const etHour = ((parseInt(b.hour) - 4) + 24) % 24;
  const label = `${String(etHour).padStart(2, "0")}:00 ET`;
  return (
    <div className="bg-panel2 border border-border2 rounded px-3 py-2 text-[11px] font-mono">
      <div className="text-muted text-[10px] mb-1">{label}</div>
      <div className="text-bright font-semibold">{fmtP(b.premium)}</div>
      <div className="text-dim">{b.count} trades · {b.sweeps} sweeps</div>
    </div>
  );
}

function HourlyChart({ data }: { data: HourBucket[] }) {
  if (!data.length) return null;
  // convert UTC hours to ET display labels
  const display = data.map((b) => ({
    ...b,
    label: `${String(((parseInt(b.hour) - 4) + 24) % 24).padStart(2, "0")}h`,
  }));

  return (
    <div className="shrink-0 border-t border-border" style={{ height: 120 }}>
      <div className="px-3 py-1 text-[10px] text-muted uppercase tracking-widest">
        Activity by hour (ET) · {data.length} buckets
      </div>
      <ResponsiveContainer width="100%" height={88}>
        <BarChart data={display} margin={{ top: 2, right: 12, left: 0, bottom: 2 }} barCategoryGap="20%">
          <CartesianGrid stroke={C.grid} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: C.muted, fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={fmtP}
            tick={{ fill: C.muted, fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
            axisLine={false}
            tickLine={false}
            width={52}
            tickCount={3}
          />
          <Tooltip
            content={({ active, payload }) => (
              <HourTooltip active={active} payload={payload as { payload: HourBucket }[]} />
            )}
            cursor={{ fill: C.panel2, fillOpacity: 0.8 }}
          />
          <Bar dataKey="premium" radius={[2, 2, 0, 0]} maxBarSize={32}>
            {display.map((b) => {
              const etH = ((parseInt(b.hour) - 4) + 24) % 24;
              const isMarket = etH >= 9 && etH < 16;
              return (
                <Cell key={b.hour}
                  fill={isMarket ? C.accent : C.muted}
                  fillOpacity={isMarket ? 0.7 : 0.35}
                />
              );
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── top trades ─────────────────────────────────────────────────────────────────

function TopTrades({ trades }: { trades: TopTrade[] }) {
  if (!trades.length) return null;
  return (
    <div className="shrink-0 border-t border-border px-3 py-2">
      <div className="text-[10px] text-muted uppercase tracking-widest mb-1.5">
        Top trades by premium
      </div>
      <div className="flex flex-col gap-0.5">
        {trades.map((t) => {
          const isCall = t.option_type === "call";
          const dte = t.expiry
            ? Math.round((new Date(t.expiry).getTime() - Date.now()) / 86400000)
            : null;
          return (
            <div key={t.id}
              className="flex items-center gap-3 text-[11px] tabular-nums py-0.5">
              <span className="font-bold text-bright w-[52px]">{t.symbol}</span>
              <span className={`w-[16px] font-semibold ${isCall ? "text-bull" : "text-bear"}`}>
                {isCall ? "C" : "P"}
              </span>
              <span className="text-dim w-[52px]">${t.strike}</span>
              <span className="text-muted text-[10px] w-[44px]">{t.expiry?.slice(5)}</span>
              {dte != null && (
                <span className={`text-[10px] w-[28px] ${dte <= 7 ? "text-bear" : "text-muted"}`}>
                  {dte}d
                </span>
              )}
              <span className="font-bold text-bright">{fmtP(t.premium)}</span>
              {t.is_sweep && (
                <span className="text-[9px] text-gold bg-gold/10 border border-gold/30 px-1 rounded">SWP</span>
              )}
              <span className={`ml-auto text-[10px] font-semibold
                ${t.flow_score >= 9 ? "text-extreme"
                : t.flow_score >= 6 ? "text-gold"
                : "text-bull"}`}>
                {t.flow_score}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── main component ─────────────────────────────────────────────────────────────

export default function FlowStats({ hours, minScore }: Props) {
  const [data, setData]       = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  useEffect(() => {
    setLoading(true);
    setError("");
    getFlowStats({ hours, min_score: minScore })
      .then(setData)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load stats"))
      .finally(() => setLoading(false));
  }, [hours, minScore]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted text-[11px]">
        loading stats…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-bear text-[11px]">{error}</div>
    );
  }
  if (!data || data.summary.total_count === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted text-[11px]">
        No flow data in the last {hours}h — stream events will appear here once detected
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <SummaryCards s={data.summary} />
      <Leaderboard rows={data.symbol_totals} />
      <TopTrades trades={data.top_trades} />
      <HourlyChart data={data.hourly} />
    </div>
  );
}
