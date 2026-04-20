import { useEffect, useState } from "react";
import { getPositions, syncSchwab, syncRobinhood, deletePosition } from "../api";

interface Position {
  id: number;
  symbol: string;
  quantity: number;
  avg_cost: number;
  option_type: "call" | "put" | null;
  strike: number | null;
  expiry: string | null;
  source: string;
  last?: number | null;
  delta?: number | null;
}

// ── mock data shown until Schwab connects ──────────────────────────────────────

const MOCK_EQUITY: Position[] = [
  { id: -1, symbol: "SPY",  quantity: 50,  avg_cost: 540.00, option_type: null, strike: null, expiry: null, source: "mock", last: 558.42 },
  { id: -2, symbol: "NVDA", quantity: 25,  avg_cost: 180.00, option_type: null, strike: null, expiry: null, source: "mock", last: 121.32 },
  { id: -3, symbol: "AAPL", quantity: 100, avg_cost: 220.00, option_type: null, strike: null, expiry: null, source: "mock", last: 207.14 },
];

const MOCK_OPTIONS: Position[] = [
  { id: -4, symbol: "SPY",  quantity: 5,  avg_cost: 4.20, option_type: "call", strike: 720, expiry: "2025-06-20", source: "mock", last: 0.38, delta: 0.08 },
  { id: -5, symbol: "NVDA", quantity: 3,  avg_cost: 6.10, option_type: "put",  strike: 200, expiry: "2025-05-17", source: "mock", last: 11.20, delta: -0.52 },
];

// ── helpers ────────────────────────────────────────────────────────────────────

const f2 = (n: number | null | undefined) => n != null ? n.toFixed(2) : "—";

function pnlColor(pnl: number | null): string {
  if (pnl == null) return "text-muted";
  return pnl >= 0 ? "text-bull" : "text-bear";
}

function pnlFmt(pnl: number | null): string {
  if (pnl == null) return "—";
  const sign = pnl >= 0 ? "+" : "";
  const abs = Math.abs(pnl);
  if (abs >= 1_000_000) return `${sign}$${(pnl / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(pnl / 1_000).toFixed(1)}K`;
  return `${sign}$${pnl.toFixed(2)}`;
}

function equityPnl(p: Position) {
  if (p.last == null) return { total: null, pct: null };
  const total = (p.last - p.avg_cost) * p.quantity;
  const pct = ((p.last - p.avg_cost) / p.avg_cost) * 100;
  return { total, pct };
}

function optionPnl(p: Position) {
  if (p.last == null) return { total: null };
  const total = (p.last - p.avg_cost) * p.quantity * 100;
  return { total };
}

// ── portfolio summary ──────────────────────────────────────────────────────────

function Summary({ equity, opts }: { equity: Position[]; opts: Position[] }) {
  let totalValue = 0;
  let totalPnl = 0;

  for (const p of equity) {
    if (p.last != null) {
      totalValue += p.last * p.quantity;
      totalPnl += (p.last - p.avg_cost) * p.quantity;
    }
  }
  for (const p of opts) {
    if (p.last != null) {
      totalValue += p.last * p.quantity * 100;
      totalPnl += (p.last - p.avg_cost) * p.quantity * 100;
    }
  }

  const totalCost = equity.reduce((s, p) => s + p.avg_cost * p.quantity, 0) +
                    opts.reduce((s, p) => s + p.avg_cost * p.quantity * 100, 0);
  const totalPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : null;

  const metrics = [
    { label: "TOTAL VALUE", value: `$${(totalValue / 1000).toFixed(1)}K` },
    { label: "TOTAL P&L",   value: pnlFmt(totalPnl),      color: pnlColor(totalPnl) },
    { label: "RETURN",      value: totalPct != null ? `${totalPct >= 0 ? "+" : ""}${totalPct.toFixed(2)}%` : "—", color: pnlColor(totalPct) },
  ];

  return (
    <div className="shrink-0 flex gap-6 px-4 py-3 border-b border-border bg-panel">
      {metrics.map(({ label, value, color }) => (
        <div key={label} className="flex flex-col gap-0.5">
          <span className="text-[9px] text-muted tracking-widest uppercase">{label}</span>
          <span className={`text-sm font-semibold tabular-nums ${color ?? "text-bright"}`}>{value}</span>
        </div>
      ))}
    </div>
  );
}

// ── component ──────────────────────────────────────────────────────────────────

export default function PositionsDashboard() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [useMock, setUseMock]     = useState(false);
  const [loading, setLoading]     = useState(false);
  const [syncing, setSyncing]     = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data: Position[] = await getPositions();
      if (data.length === 0) {
        setPositions([]);
        setUseMock(true);
      } else {
        setPositions(data);
        setUseMock(false);
      }
    } catch {
      setUseMock(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSync(source: "schwab" | "robinhood") {
    setSyncing(source);
    try {
      if (source === "schwab") await syncSchwab();
      else await syncRobinhood();
      await load();
    } catch {
      // backend offline / not authed
    } finally {
      setSyncing(null);
    }
  }

  async function handleDelete(id: number) {
    if (id < 0) return; // mock rows
    await deletePosition(id);
    setPositions((prev) => prev.filter((p) => p.id !== id));
  }

  const displayed  = useMock ? [...MOCK_EQUITY, ...MOCK_OPTIONS] : positions;
  const equity     = displayed.filter((p) => !p.option_type);
  const opts       = displayed.filter((p) => p.option_type);

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* summary header */}
      <Summary equity={equity} opts={opts} />

      {/* toolbar */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-2 border-b border-border bg-panel flex-wrap">
        <button className="t-btn text-[10px]" onClick={() => handleSync("schwab")} disabled={!!syncing}>
          {syncing === "schwab" ? "syncing…" : "↻ SCHWAB"}
        </button>
        <button className="t-btn text-[10px]" onClick={() => handleSync("robinhood")} disabled={!!syncing}>
          {syncing === "robinhood" ? "syncing…" : "↻ ROBINHOOD"}
        </button>

        {useMock && (
          <span className="text-gold text-[10px] ml-1">
            ⚠ mock data — connect Schwab to see real positions
          </span>
        )}

        <div className="flex-1" />
        {loading && <span className="text-muted text-[10px]">loading…</span>}
        <span className="text-muted text-[10px]">
          {equity.length} equity · {opts.length} options
        </span>
      </div>

      {/* tables */}
      <div className="flex-1 overflow-y-auto">

        {/* equity */}
        {equity.length > 0 && (
          <div>
            <div className="sticky top-0 z-10">
              <div className="px-3 py-1 bg-panel text-[10px] text-bull tracking-widest border-b border-border">
                ── EQUITY ──
              </div>
              <div className="flex text-[9px] text-muted uppercase tracking-wide bg-panel2 border-b border-border">
                <div className="w-[80px] shrink-0 px-3 py-1">Symbol</div>
                <div className="w-[64px] shrink-0 px-2 py-1 text-right">Shares</div>
                <div className="w-[80px] shrink-0 px-2 py-1 text-right">Avg Cost</div>
                <div className="w-[80px] shrink-0 px-2 py-1 text-right">Last</div>
                <div className="w-[96px] shrink-0 px-2 py-1 text-right">Total P&L</div>
                <div className="w-[72px] shrink-0 px-2 py-1 text-right">Return</div>
                <div className="flex-1 px-2 py-1 text-right">Source</div>
                <div className="w-8 px-2 py-1" />
              </div>
            </div>

            {equity.map((p) => {
              const { total, pct } = equityPnl(p);
              return (
                <div key={p.id}
                  className="flex items-center text-[11px] tabular-nums border-b border-border hover:bg-panel2/50 transition-colors">
                  <div className="w-[80px] shrink-0 px-3 py-[5px] font-bold text-bright">{p.symbol}</div>
                  <div className="w-[64px] shrink-0 px-2 py-[5px] text-right text-dim">{p.quantity}</div>
                  <div className="w-[80px] shrink-0 px-2 py-[5px] text-right text-dim">${f2(p.avg_cost)}</div>
                  <div className="w-[80px] shrink-0 px-2 py-[5px] text-right text-bright">{p.last != null ? `$${f2(p.last)}` : "—"}</div>
                  <div className={`w-[96px] shrink-0 px-2 py-[5px] text-right font-semibold ${pnlColor(total)}`}>{pnlFmt(total)}</div>
                  <div className={`w-[72px] shrink-0 px-2 py-[5px] text-right ${pnlColor(pct)}`}>
                    {pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "—"}
                  </div>
                  <div className="flex-1 px-2 py-[5px] text-right text-muted text-[10px]">{p.source}</div>
                  <div className="w-8 px-2 py-[5px] text-center">
                    {p.id > 0 && (
                      <button onClick={() => handleDelete(p.id)}
                        className="text-muted hover:text-bear text-[10px] leading-none">✕</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* options */}
        {opts.length > 0 && (
          <div>
            <div className="sticky top-0 z-10">
              <div className="px-3 py-1 bg-panel text-[10px] text-accent tracking-widest border-b border-border border-t">
                ── OPTIONS ──
              </div>
              <div className="flex text-[9px] text-muted uppercase tracking-wide bg-panel2 border-b border-border">
                <div className="w-[72px] shrink-0 px-3 py-1">Symbol</div>
                <div className="w-[44px] shrink-0 px-2 py-1 text-center">Type</div>
                <div className="w-[72px] shrink-0 px-2 py-1 text-right">Strike</div>
                <div className="w-[80px] shrink-0 px-2 py-1 text-right">Expiry</div>
                <div className="w-[56px] shrink-0 px-2 py-1 text-right">Qty</div>
                <div className="w-[80px] shrink-0 px-2 py-1 text-right">Avg Cost</div>
                <div className="w-[80px] shrink-0 px-2 py-1 text-right">Last</div>
                <div className="w-[48px] shrink-0 px-2 py-1 text-right">Δ</div>
                <div className="w-[96px] shrink-0 px-2 py-1 text-right">P&L</div>
                <div className="flex-1 px-2 py-1 text-right">Source</div>
                <div className="w-8 px-2 py-1" />
              </div>
            </div>

            {opts.map((p) => {
              const { total } = optionPnl(p);
              const isCall = p.option_type === "call";
              const dte = p.expiry
                ? Math.round((new Date(p.expiry).getTime() - Date.now()) / 86400000)
                : null;
              return (
                <div key={p.id}
                  className="flex items-center text-[11px] tabular-nums border-b border-border hover:bg-panel2/50 transition-colors">
                  <div className="w-[72px] shrink-0 px-3 py-[5px] font-bold text-bright">{p.symbol}</div>
                  <div className={`w-[44px] shrink-0 px-2 py-[5px] text-center font-semibold ${isCall ? "text-bull" : "text-bear"}`}>
                    {isCall ? "CALL" : "PUT"}
                  </div>
                  <div className="w-[72px] shrink-0 px-2 py-[5px] text-right text-bright">${f2(p.strike)}</div>
                  <div className="w-[80px] shrink-0 px-2 py-[5px] text-right text-dim text-[10px]">
                    {p.expiry?.slice(5)}
                    {dte != null && (
                      <span className={`ml-1 text-[9px] ${dte <= 7 ? "text-bear" : dte <= 30 ? "text-gold" : "text-muted"}`}>
                        {dte}d
                      </span>
                    )}
                  </div>
                  <div className="w-[56px] shrink-0 px-2 py-[5px] text-right text-dim">{p.quantity}</div>
                  <div className="w-[80px] shrink-0 px-2 py-[5px] text-right text-dim">${f2(p.avg_cost)}</div>
                  <div className="w-[80px] shrink-0 px-2 py-[5px] text-right text-bright">{p.last != null ? `$${f2(p.last)}` : "—"}</div>
                  <div className="w-[48px] shrink-0 px-2 py-[5px] text-right text-muted">{p.delta != null ? p.delta.toFixed(2) : "—"}</div>
                  <div className={`w-[96px] shrink-0 px-2 py-[5px] text-right font-semibold ${pnlColor(total)}`}>{pnlFmt(total)}</div>
                  <div className="flex-1 px-2 py-[5px] text-right text-muted text-[10px]">{p.source}</div>
                  <div className="w-8 px-2 py-[5px] text-center">
                    {p.id > 0 && (
                      <button onClick={() => handleDelete(p.id)}
                        className="text-muted hover:text-bear text-[10px] leading-none">✕</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && displayed.length === 0 && (
          <div className="flex items-center justify-center h-32 text-muted text-[11px]">
            No positions — sync from Schwab or Robinhood
          </div>
        )}
      </div>

      {/* legend */}
      <div className="shrink-0 border-t border-border px-3 py-1 flex gap-4 text-[10px] text-muted bg-panel">
        <span className="text-bull">▲ profit</span>
        <span className="text-bear">▼ loss</span>
        <div className="flex-1" />
        <span>Last price from Polygon prev-close · P&L = (last − avg cost) × qty</span>
      </div>
    </div>
  );
}
