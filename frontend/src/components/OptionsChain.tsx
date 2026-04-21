import { useEffect, useState } from "react";
import { getChain } from "../api";

interface Props {
  symbol: string;
  onSymbolChange?: (s: string) => void;
}

interface Contract {
  ticker:        string | null;
  symbol:        string;
  contract_type: "call" | "put" | null;
  strike:        number | null;
  expiry:        string | null;
  bid:           number | null;
  ask:           number | null;
  mid:           number | null;
  last:          number | null;
  volume:        number;
  open_interest: number;
  iv:            number | null;
  delta:         number | null;
  gamma:         number | null;
  theta:         number | null;
  vega:          number | null;
  underlying_price: number | null;
  in_the_money:  boolean;
}

type Chain = Record<string, Record<number, { call?: Contract; put?: Contract }>>;

function groupChain(contracts: Contract[]): Chain {
  const out: Chain = {};
  for (const c of contracts) {
    if (!c.expiry || c.strike == null || !c.contract_type) continue;
    (out[c.expiry] ??= {});
    (out[c.expiry][c.strike] ??= {});
    out[c.expiry][c.strike][c.contract_type] = c;
  }
  return out;
}

// ─── cell helpers ───────────────────────────────────────────────────────────────

const f2 = (v: number | null | undefined) => v != null ? v.toFixed(2) : "—";
const fv = (v: number) => v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M`
                        : v >= 1_000     ? `${(v / 1_000).toFixed(0)}K`
                        : String(v || "—");

function CallCells({ c }: { c: Contract | undefined }) {
  const itm = c?.in_the_money;
  const bg = itm ? "bg-bull/5" : "";
  const hl = itm ? "text-bull" : "text-dim";
  return (
    <>
      <td className={`px-2 py-[3px] text-right tabular-nums ${bg} ${hl}`}>{f2(c?.bid)}</td>
      <td className={`px-2 py-[3px] text-right tabular-nums ${bg} text-bright`}>{f2(c?.ask)}</td>
      <td className={`px-2 py-[3px] text-right tabular-nums ${bg} text-bull`}>
        {c ? fv(c.volume) : "—"}
      </td>
      <td className={`px-2 py-[3px] text-right tabular-nums ${bg} text-muted`}>
        {c ? fv(c.open_interest) : "—"}
      </td>
      <td className={`px-2 py-[3px] text-right tabular-nums ${bg} text-dim`}>
        {f2(c?.delta)}
      </td>
      <td className={`px-2 py-[3px] text-right tabular-nums ${bg} text-muted text-[11px]`}>
        {c?.iv != null ? `${(c.iv * 100).toFixed(0)}%` : "—"}
      </td>
    </>
  );
}

function PutCells({ c }: { c: Contract | undefined }) {
  const itm = c?.in_the_money;
  const bg = itm ? "bg-bear/5" : "";
  const hl = itm ? "text-bear" : "text-dim";
  return (
    <>
      <td className={`px-2 py-[3px] text-right tabular-nums ${bg} text-muted text-[11px]`}>
        {c?.iv != null ? `${(c.iv * 100).toFixed(0)}%` : "—"}
      </td>
      <td className={`px-2 py-[3px] text-right tabular-nums ${bg} text-dim`}>
        {f2(c?.delta)}
      </td>
      <td className={`px-2 py-[3px] text-right tabular-nums ${bg} text-muted`}>
        {c ? fv(c.open_interest) : "—"}
      </td>
      <td className={`px-2 py-[3px] text-right tabular-nums ${bg} text-bear`}>
        {c ? fv(c.volume) : "—"}
      </td>
      <td className={`px-2 py-[3px] text-right tabular-nums ${bg} text-bright`}>{f2(c?.bid)}</td>
      <td className={`px-2 py-[3px] text-right tabular-nums ${bg} ${hl}`}>{f2(c?.ask)}</td>
    </>
  );
}

// ─── component ─────────────────────────────────────────────────────────────────

export default function OptionsChain({ symbol, onSymbolChange }: Props) {
  const [inputSym, setInputSym]       = useState(symbol);
  const [chain, setChain]             = useState<Chain>({});
  const [expiries, setExpiries]       = useState<string[]>([]);
  const [selectedExp, setSelectedExp] = useState("");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [underlying, setUnderlying]   = useState<number | null>(null);
  const [contractType, setContractType] = useState<"" | "call" | "put">("");

  useEffect(() => {
    setInputSym(symbol);
    loadChain(symbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  async function loadChain(sym: string) {
    if (!sym) return;
    setLoading(true);
    setError("");
    setChain({});
    try {
      const data: Contract[] = await getChain(sym, "polygon", {
        contract_type: contractType || undefined,
      });
      if (!Array.isArray(data)) { setError("Unexpected response."); return; }

      const up = data.find((c) => c.underlying_price)?.underlying_price ?? null;
      setUnderlying(up);

      const grouped = groupChain(data);
      const exps = Object.keys(grouped).sort();
      setChain(grouped);
      setExpiries(exps);
      setSelectedExp(exps[0] ?? "");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load chain.");
    } finally {
      setLoading(false);
    }
  }

  function commitSym() {
    const s = inputSym.trim().toUpperCase();
    if (!s) return;
    onSymbolChange?.(s);
    loadChain(s);
  }

  useEffect(() => {
    if (selectedExp) return; // don't re-fetch on expiry change
    loadChain(symbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contractType]);

  const strikes = selectedExp
    ? Object.keys(chain[selectedExp] ?? {}).map(Number).sort((a, b) => a - b)
    : [];

  // find ATM strike
  const atmStrike = underlying != null
    ? strikes.reduce((best, s) =>
        Math.abs(s - underlying!) < Math.abs(best - underlying!) ? s : best
      , strikes[0] ?? 0)
    : null;

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── toolbar ── */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-2 border-b border-border bg-panel flex-wrap">
        {/* symbol input */}
        <div className="flex items-center gap-1.5">
          <span className="text-muted text-[11px]">TICKER</span>
          <input
            className="t-input w-16 uppercase"
            value={inputSym}
            onChange={(e) => setInputSym(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && commitSym()}
            onBlur={commitSym}
          />
        </div>

        {underlying != null && (
          <span className="text-dim text-[12px]">
            underlying <span className="text-bright font-medium">${underlying.toFixed(2)}</span>
          </span>
        )}

        <div className="w-px h-4 bg-border" />

        {/* expiry tabs */}
        <div className="flex gap-1 flex-wrap">
          {expiries.slice(0, 10).map((exp) => {
            const dte = Math.round((new Date(exp).getTime() - Date.now()) / 86400000);
            return (
              <button key={exp} onClick={() => setSelectedExp(exp)}
                className={`t-btn text-[11px] ${selectedExp === exp ? "active" : ""}`}>
                {exp.slice(5)}
                <span className="text-muted ml-1 text-[10px]">{dte}d</span>
              </button>
            );
          })}
        </div>

        <div className="w-px h-4 bg-border" />

        {/* call/put filter */}
        <div className="flex gap-1">
          {(["", "call", "put"] as const).map((t) => (
            <button key={t}
              onClick={() => { setContractType(t); }}
              className={`t-btn text-[11px] ${
                contractType === t
                  ? t === "call" ? "border-bull text-bull"
                  : t === "put"  ? "border-bear text-bear"
                  : "active"
                  : ""
              }`}>
              {t === "" ? "BOTH" : t.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {loading && <span className="text-muted text-[11px]">loading…</span>}
        {!loading && strikes.length > 0 && (
          <span className="text-muted text-[11px]">{strikes.length} strikes · polygon</span>
        )}
      </div>

      {error && (
        <div className="shrink-0 px-3 py-2 text-bear text-[12px] border-b border-border">
          {error}
        </div>
      )}

      {/* ── table ── */}
      {!loading && selectedExp && (
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 z-10">
              {/* section labels */}
              <tr className="bg-panel text-[11px]">
                <th colSpan={6} className="text-center py-1 text-bull tracking-widest border-b border-border">
                  ── CALLS ──
                </th>
                <th className="text-center py-1 text-accent border-b border-border border-x border-border2 px-4">
                  STRIKE
                </th>
                <th colSpan={6} className="text-center py-1 text-bear tracking-widest border-b border-border">
                  ── PUTS ──
                </th>
              </tr>
              {/* column names */}
              <tr className="bg-panel2 border-b border-border text-[10px] text-muted uppercase tracking-wide">
                <th className="px-2 py-1 text-right">Bid</th>
                <th className="px-2 py-1 text-right">Ask</th>
                <th className="px-2 py-1 text-right">Vol</th>
                <th className="px-2 py-1 text-right">OI</th>
                <th className="px-2 py-1 text-right">Δ</th>
                <th className="px-2 py-1 text-right">IV</th>
                <th className="px-4 py-1 text-center border-x border-border2" />
                <th className="px-2 py-1 text-right">IV</th>
                <th className="px-2 py-1 text-right">Δ</th>
                <th className="px-2 py-1 text-right">OI</th>
                <th className="px-2 py-1 text-right">Vol</th>
                <th className="px-2 py-1 text-right">Bid</th>
                <th className="px-2 py-1 text-right">Ask</th>
              </tr>
            </thead>
            <tbody>
              {strikes.map((strike) => {
                const row  = chain[selectedExp]?.[strike] ?? {};
                const isAtm = strike === atmStrike;
                return (
                  <tr key={strike}
                    className={`border-b border-border text-[12px] tabular-nums
                      ${isAtm ? "bg-accent/5 border-y border-accent/20" : "hover:bg-panel2/50"}`}>
                    <CallCells c={row.call} />
                    <td className={`px-4 py-[3px] text-center font-semibold border-x border-border2
                      ${isAtm ? "text-accent" : "text-dim"}`}>
                      {strike % 1 === 0 ? strike : strike.toFixed(1)}
                      {isAtm && <span className="ml-1 text-[8px] text-accent/60">ATM</span>}
                    </td>
                    <PutCells c={row.put} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !selectedExp && !error && (
        <div className="flex-1 flex items-center justify-center text-muted text-[12px]">
          Enter a ticker above to load the options chain
        </div>
      )}

      {/* ── legend ── */}
      <div className="shrink-0 border-t border-border px-3 py-1 flex gap-4
                      text-[11px] text-muted bg-panel">
        <span className="text-bull">■ ITM call</span>
        <span className="text-bear">■ ITM put</span>
        <span className="text-accent">— ATM strike</span>
        <div className="flex-1" />
        <span>Δ delta · IV implied vol · OI open interest · Vol daily volume</span>
      </div>
    </div>
  );
}
