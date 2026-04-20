import { useCallback, useEffect, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  BarChart,
  Area,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { getBars } from "../api";

// ── types ──────────────────────────────────────────────────────────────────────

interface BarData {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  vw?: number;
}

type Range = "1D" | "5D" | "1M" | "3M";

interface Props {
  symbol: string;
}

// ── config ─────────────────────────────────────────────────────────────────────

const RANGES: Range[] = ["1D", "5D", "1M", "3M"];

function rangeParams(r: Range): { multiplier: number; timespan: string; limit: number; daysBack: number } {
  switch (r) {
    case "1D": return { multiplier: 5,  timespan: "minute", limit: 78,  daysBack: 2  };
    case "5D": return { multiplier: 30, timespan: "minute", limit: 65,  daysBack: 7  };
    case "1M": return { multiplier: 1,  timespan: "day",    limit: 22,  daysBack: 32 };
    case "3M": return { multiplier: 1,  timespan: "day",    limit: 66,  daysBack: 95 };
  }
}

function isoFrom(daysBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

// ── formatting ─────────────────────────────────────────────────────────────────

function fmtX(range: Range) {
  return (ts: number) => {
    const d = new Date(ts);
    if (range === "1D" || range === "5D") {
      return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" });
    }
    return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric" });
  };
}

function fmtY(n: number): string {
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtVol(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// ── custom tooltip ─────────────────────────────────────────────────────────────

interface ChartTooltipProps {
  active?: boolean;
  payload?: { payload: BarData }[];
  range: Range;
}

function ChartTooltip({ active, payload, range }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const b = payload[0].payload;
  const d = new Date(b.t);
  const dateStr = range === "1D" || range === "5D"
    ? d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/New_York" })
    : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  const change = b.c - b.o;
  const up = change >= 0;

  return (
    <div className="bg-panel2 border border-border2 rounded px-3 py-2 text-[11px] font-mono shadow-xl">
      <div className="text-muted text-[10px] mb-1">{dateStr} ET</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <span className="text-muted">O</span><span className="text-bright tabular-nums">${b.o.toFixed(2)}</span>
        <span className="text-muted">H</span><span className="text-bull  tabular-nums">${b.h.toFixed(2)}</span>
        <span className="text-muted">L</span><span className="text-bear  tabular-nums">${b.l.toFixed(2)}</span>
        <span className="text-muted">C</span><span className={`tabular-nums font-semibold ${up ? "text-bull" : "text-bear"}`}>${b.c.toFixed(2)}</span>
        <span className="text-muted">Vol</span><span className="text-dim tabular-nums">{fmtVol(b.v)}</span>
        {b.vw != null && <><span className="text-muted">VW</span><span className="text-dim tabular-nums">${b.vw.toFixed(2)}</span></>}
      </div>
      <div className={`mt-1.5 text-[10px] font-semibold ${up ? "text-bull" : "text-bear"}`}>
        {up ? "+" : ""}{change.toFixed(2)} ({((change / b.o) * 100).toFixed(2)}%)
      </div>
    </div>
  );
}

// ── summary bar ────────────────────────────────────────────────────────────────

function Summary({ data, symbol }: { data: BarData[]; symbol: string }) {
  if (!data.length) return null;
  const first = data[0];
  const last  = data[data.length - 1];
  const open  = first.o;
  const close = last.c;
  const high  = Math.max(...data.map((b) => b.h));
  const low   = Math.min(...data.map((b) => b.l));
  const change = close - open;
  const changePct = (change / open) * 100;
  const up = change >= 0;

  return (
    <div className="shrink-0 flex items-center gap-5 px-4 py-2.5 border-b border-border bg-panel">
      <span className="font-bold text-bright text-sm tracking-wide">{symbol}</span>
      <span className={`text-xl font-semibold tabular-nums ${up ? "text-bull" : "text-bear"}`}>
        ${close.toFixed(2)}
      </span>
      <span className={`text-[12px] font-medium tabular-nums ${up ? "text-bull" : "text-bear"}`}>
        {up ? "+" : ""}{change.toFixed(2)} ({up ? "+" : ""}{changePct.toFixed(2)}%)
      </span>

      <div className="w-px h-4 bg-border" />

      {[
        ["O", open.toFixed(2)],
        ["H", high.toFixed(2)],
        ["L", low.toFixed(2)],
      ].map(([label, val]) => (
        <div key={label} className="flex gap-1 text-[11px]">
          <span className="text-muted">{label}</span>
          <span className="text-dim tabular-nums">${val}</span>
        </div>
      ))}
    </div>
  );
}

// ── component ──────────────────────────────────────────────────────────────────

// Colors hardcoded — Tailwind classes don't work inside recharts SVG
const C = {
  bull:    "#3fb950",
  bear:    "#f85149",
  accent:  "#58a6ff",
  grid:    "#1c2128",
  border2: "#30363d",
  muted:   "#484f58",
  dim:     "#8b949e",
  panel2:  "#111820",
  vol:     "#21262d",
};

export default function PriceChart({ symbol }: Props) {
  const [data, setData]     = useState<BarData[]>([]);
  const [range, setRange]   = useState<Range>("1D");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState("");

  const load = useCallback(async (sym: string, r: Range) => {
    setLoading(true);
    setError("");
    const { multiplier, timespan, limit, daysBack } = rangeParams(r);
    const from = isoFrom(daysBack);
    try {
      const bars: BarData[] = await getBars(sym, { multiplier, timespan, limit, from });
      setData(bars);
      if (!bars.length) setError(`No bar data for ${sym} (${r})`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load bars");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(symbol, range); }, [symbol, range, load]);

  const up = data.length >= 2
    ? data[data.length - 1].c >= data[0].o
    : true;
  const priceColor   = up ? C.bull : C.bear;
  const gradientId   = up ? "gradUp" : "gradDown";

  // open price for reference line
  const openPrice = data[0]?.o ?? null;

  const tickFormatter = fmtX(range);

  // reduce X axis ticks to avoid crowding
  const tickCount = range === "1D" ? 8 : range === "5D" ? 10 : 6;
  const step = data.length > tickCount ? Math.ceil(data.length / tickCount) : 1;
  const ticks = data.filter((_, i) => i % step === 0).map((b) => b.t);

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* summary header */}
      <Summary data={data} symbol={symbol} />

      {/* toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-2 border-b border-border bg-panel">
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button key={r} onClick={() => setRange(r)}
              className={`t-btn text-[10px] ${range === r ? "active" : ""}`}>
              {r}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {loading && <span className="text-muted text-[10px]">loading…</span>}
        {!loading && data.length > 0 && (
          <span className="text-muted text-[10px]">{data.length} bars · polygon</span>
        )}
      </div>

      {error && (
        <div className="shrink-0 px-3 py-2 text-bear text-[11px] border-b border-border">{error}</div>
      )}

      {/* charts */}
      {!loading && data.length > 0 && (
        <div className="flex-1 flex flex-col overflow-hidden px-1 py-2">

          {/* price chart — 70% */}
          <div style={{ flex: "0 0 70%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} syncId="pricechart">
                <defs>
                  <linearGradient id="gradUp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={C.bull}  stopOpacity={0.25} />
                    <stop offset="100%" stopColor={C.bull}  stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="gradDown" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stopColor={C.bear}  stopOpacity={0.25} />
                    <stop offset="100%" stopColor={C.bear}  stopOpacity={0.02} />
                  </linearGradient>
                </defs>

                <CartesianGrid stroke={C.grid} strokeDasharray="2 4" vertical={false} />

                <XAxis
                  dataKey="t"
                  type="number"
                  domain={["dataMin", "dataMax"]}
                  scale="time"
                  ticks={ticks}
                  tickFormatter={tickFormatter}
                  tick={{ fill: C.muted, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                  axisLine={{ stroke: C.grid }}
                  tickLine={false}
                />

                <YAxis
                  domain={["auto", "auto"]}
                  tickFormatter={fmtY}
                  tick={{ fill: C.dim, fontSize: 10, fontFamily: "JetBrains Mono, monospace" }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                />

                {openPrice != null && (
                  <ReferenceLine
                    y={openPrice}
                    stroke={C.border2}
                    strokeDasharray="4 4"
                    strokeWidth={1}
                  />
                )}

                <Tooltip
                  content={({ active, payload }) => (
                    <ChartTooltip
                      active={active}
                      payload={payload as { payload: BarData }[]}
                      range={range}
                    />
                  )}
                  cursor={{ stroke: C.border2, strokeWidth: 1 }}
                />

                <Area
                  type="monotone"
                  dataKey="c"
                  stroke={priceColor}
                  strokeWidth={1.5}
                  fill={`url(#${gradientId})`}
                  dot={false}
                  activeDot={{ r: 3, fill: priceColor, strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* volume chart — 30% */}
          <div style={{ flex: "0 0 30%" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 2, right: 12, left: 0, bottom: 0 }}
                syncId="pricechart" barCategoryGap="2%">
                <XAxis dataKey="t" hide />
                <YAxis
                  tickFormatter={fmtVol}
                  tick={{ fill: C.muted, fontSize: 9, fontFamily: "JetBrains Mono, monospace" }}
                  axisLine={false}
                  tickLine={false}
                  width={60}
                  tickCount={3}
                />
                <Tooltip content={() => null} cursor={{ fill: C.border2, fillOpacity: 0.3 }} />
                <Bar dataKey="v" fill={C.vol} radius={[1, 1, 0, 0]} maxBarSize={10} />
              </BarChart>
            </ResponsiveContainer>
          </div>

        </div>
      )}

      {!loading && data.length === 0 && !error && (
        <div className="flex-1 flex items-center justify-center text-muted text-[11px]">
          Enter a symbol to load the chart
        </div>
      )}

      {/* legend */}
      <div className="shrink-0 border-t border-border px-3 py-1 flex gap-4 text-[10px] text-muted bg-panel">
        <span>Area = close price</span>
        <span>Bars = volume</span>
        <span className="text-border2">— dashed = open price</span>
        <div className="flex-1" />
        <span>Polygon {range === "1D" || range === "5D" ? "intraday" : "daily"} aggregates</span>
      </div>
    </div>
  );
}
