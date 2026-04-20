import { useEffect, useRef, useState } from "react";
import { getQuotes, getBars, watchSymbols } from "../api";

interface Props {
  onSelectSymbol: (s: string) => void;
}

interface Quote {
  symbol: string;
  last:       number | null;
  bid:        number | null;
  ask:        number | null;
  change:     number | null;
  change_pct: number | null;
  volume:     number | null;
  source?:    string;
}

const DEFAULT_SYMBOLS = ["SPY", "QQQ", "AAPL", "USO", "NVDA"];

// ── sparkline ──────────────────────────────────────────────────────────────────

interface SparkBar { c: number }

function Sparkline({ bars }: { bars: SparkBar[] }) {
  if (bars.length < 2) return <div className="w-16 h-5 inline-block" />;
  const closes = bars.map((b) => b.c);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const W = 64, H = 20, pad = 1;
  const pts = closes
    .map((c, i) => {
      const x = (i / (closes.length - 1)) * (W - pad * 2) + pad;
      const y = H - pad - ((c - min) / range) * (H - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const up = closes[closes.length - 1] >= closes[0];
  return (
    <svg width={W} height={H} style={{ display: "block" }}>
      <polyline
        points={pts}
        fill="none"
        stroke={up ? "#3fb950" : "#f85149"}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.8}
      />
    </svg>
  );
}

function isoAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const fmt2 = (n: number | null) => n != null ? n.toFixed(2) : "—";
const fmtPct = (n: number | null) =>
  n != null ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}%` : "—";
const fmtVol = (n: number | null) => {
  if (n == null) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
};

export default function Watchlist({ onSelectSymbol }: Props) {
  const [symbols, setSymbols]   = useState<string[]>(DEFAULT_SYMBOLS);
  const [quotes, setQuotes]     = useState<Record<string, Quote>>({});
  const [input, setInput]       = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const prevRef = useRef<Record<string, number | null>>({});
  const [flashes, setFlashes]   = useState<Record<string, "up" | "down" | null>>({});
  const [sparklines, setSparklines] = useState<Record<string, SparkBar[]>>({});

  async function fetchQuotes(syms: string[]) {
    if (!syms.length) return;
    try {
      const data: Record<string, Quote> = await getQuotes(syms);
      setQuotes((prev) => {
        const next = { ...prev, ...data };
        const newFlashes: Record<string, "up" | "down" | null> = {};
        for (const sym of syms) {
          const prevLast = prevRef.current[sym];
          const newLast  = next[sym]?.last ?? null;
          if (prevLast != null && newLast != null && newLast !== prevLast) {
            newFlashes[sym] = newLast > prevLast ? "up" : "down";
          }
          prevRef.current[sym] = newLast;
        }
        if (Object.keys(newFlashes).length) {
          setFlashes(newFlashes);
          setTimeout(() => setFlashes({}), 700);
        }
        return next;
      });
    } catch {/* backend offline */}
  }

  useEffect(() => {
    fetchQuotes(symbols);
    const id = setInterval(() => fetchQuotes(symbols), 5000);
    return () => clearInterval(id);
  }, [symbols]);

  // load sparklines lazily — stagger requests to avoid rate limits
  useEffect(() => {
    const missing = symbols.filter((s) => !sparklines[s]);
    missing.forEach((sym, i) => {
      setTimeout(() => {
        getBars(sym, { multiplier: 30, timespan: "minute", limit: 20, from: isoAgo(6) })
          .then((bars: SparkBar[]) =>
            setSparklines((prev) => ({ ...prev, [sym]: bars }))
          )
          .catch(() => {});
      }, i * 400);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols.join(",")]);

  function addSymbol() {
    const sym = input.trim().toUpperCase();
    if (!sym || symbols.includes(sym)) { setInput(""); return; }
    const next = [...symbols, sym];
    setSymbols(next);
    setInput("");
    watchSymbols([sym]).catch(() => {});
    fetchQuotes([sym]);
  }

  function removeSymbol(sym: string) {
    setSymbols((prev) => prev.filter((s) => s !== sym));
  }

  function handleRowClick(sym: string) {
    setSelected(sym);
    onSelectSymbol(sym);
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* add bar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-panel">
        <input
          className="t-input flex-1 max-w-xs uppercase"
          placeholder="add ticker…"
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && addSymbol()}
        />
        <button className="t-btn" onClick={addSymbol}>ADD</button>
        <span className="text-muted text-[10px] ml-2">
          polling every 5s · schwab pending
        </span>
      </div>

      {/* table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-panel z-10">
            <tr className="border-b border-border text-[10px] text-muted uppercase tracking-wider">
              <th className="px-3 py-1.5 text-left w-6">#</th>
              <th className="px-3 py-1.5 text-left">Symbol</th>
              <th className="px-3 py-1.5 text-right">Last</th>
              <th className="px-3 py-1.5 text-right">Chg $</th>
              <th className="px-3 py-1.5 text-right">Chg %</th>
              <th className="px-3 py-1.5 text-right">Bid</th>
              <th className="px-3 py-1.5 text-right">Ask</th>
              <th className="px-3 py-1.5 text-right">Volume</th>
              <th className="px-3 py-1.5 text-center">5D</th>
              <th className="px-3 py-1.5 text-right w-8" />
            </tr>
          </thead>
          <tbody>
            {symbols.map((sym, i) => {
              const q = quotes[sym];
              const chg = q?.change ?? null;
              const pct = q?.change_pct ?? null;
              const isUp = chg != null && chg >= 0;
              const chgColor = chg == null ? "text-muted" : isUp ? "text-bull" : "text-bear";
              const flash = flashes[sym];
              const isSelected = sym === selected;

              return (
                <tr
                  key={sym}
                  onClick={() => handleRowClick(sym)}
                  className={`border-b border-border cursor-pointer transition-colors text-xs
                    ${flash === "up"   ? "flash-up"   : ""}
                    ${flash === "down" ? "flash-down" : ""}
                    ${isSelected ? "bg-panel2" : "hover:bg-panel2/60"}
                  `}
                >
                  <td className="px-3 py-1.5 text-muted text-[10px]">{i + 1}</td>

                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      {isSelected && <span className="text-accent text-[8px]">▶</span>}
                      <span className="font-semibold text-bright">{sym}</span>
                    </div>
                  </td>

                  <td className="px-3 py-1.5 text-right tabular-nums font-medium text-bright">
                    {q?.last != null ? `$${fmt2(q.last)}` : <span className="text-muted">—</span>}
                  </td>

                  <td className={`px-3 py-1.5 text-right tabular-nums ${chgColor}`}>
                    {chg != null ? `${isUp ? "+" : ""}${fmt2(chg)}` : "—"}
                  </td>

                  <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${chgColor}`}>
                    {fmtPct(pct)}
                  </td>

                  <td className="px-3 py-1.5 text-right tabular-nums text-dim">
                    {fmt2(q?.bid ?? null)}
                  </td>

                  <td className="px-3 py-1.5 text-right tabular-nums text-dim">
                    {fmt2(q?.ask ?? null)}
                  </td>

                  <td className="px-3 py-1.5 text-right tabular-nums text-muted">
                    {fmtVol(q?.volume ?? null)}
                  </td>

                  <td className="px-3 py-1.5 text-center">
                    <Sparkline bars={sparklines[sym] ?? []} />
                  </td>

                  <td className="px-3 py-1.5 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); removeSymbol(sym); }}
                      className="text-muted hover:text-bear text-[10px] leading-none"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {symbols.length === 0 && (
          <div className="flex items-center justify-center h-32 text-muted text-[10px]">
            Add tickers above to populate watchlist
          </div>
        )}
      </div>

      {/* legend */}
      <div className="shrink-0 border-t border-border px-3 py-1.5 flex items-center gap-4 text-[10px] text-muted">
        <span className="text-bull">▲ up</span>
        <span className="text-bear">▼ down</span>
        <span>click row → open chart</span>
        <div className="flex-1" />
        <span>{symbols.length} symbols · source: polygon</span>
      </div>
    </div>
  );
}
