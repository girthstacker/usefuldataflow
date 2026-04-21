import { useEffect, useRef, useState } from "react";
import { getFutures, getCrypto, MARKET_STREAM_WS } from "../api";

interface MarketItem {
  symbol:      string;
  display:     string;
  name:        string;
  last:        number | null;
  change:      number | null;
  change_pct:  number | null;
  volume_24h?: number | null;
  source:      string;
  asset_type:  "futures" | "crypto";
  updated_at:  string;
}

const fmt = (n: number | null, dec = 2) =>
  n != null ? n.toFixed(dec) : "—";

const fmtPct = (n: number | null) =>
  n != null ? `${n >= 0 ? "+" : ""}${n.toFixed(2)}%` : "—";

const fmtVol = (n: number | null | undefined) => {
  if (!n) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${(n / 1e3).toFixed(0)}K`;
};

function chgColor(n: number | null) {
  if (n == null) return "text-muted";
  return n >= 0 ? "text-bull" : "text-bear";
}

function PriceRow({ item, flash }: { item: MarketItem; flash: "up" | "down" | null }) {
  const isCrypto = item.asset_type === "crypto";
  const dec = isCrypto && item.last && item.last < 1 ? 6 : isCrypto ? 2 : 2;

  return (
    <tr className={`border-b border-border transition-colors
      ${flash === "up" ? "flash-up" : flash === "down" ? "flash-down" : ""}
    `}>
      <td className="px-3 py-2 font-bold text-bright tabular-nums">{item.display}</td>
      <td className="px-3 py-2 text-dim">{item.name}</td>
      <td className="px-3 py-2 text-right tabular-nums font-medium text-bright">
        {item.last != null ? `${isCrypto ? "$" : ""}${fmt(item.last, dec)}` : <span className="text-muted">—</span>}
      </td>
      <td className={`px-3 py-2 text-right tabular-nums ${chgColor(item.change)}`}>
        {item.change != null
          ? `${item.change >= 0 ? "+" : ""}${fmt(item.change, dec)}`
          : "—"}
      </td>
      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${chgColor(item.change_pct)}`}>
        {fmtPct(item.change_pct)}
      </td>
      {isCrypto && (
        <td className="px-3 py-2 text-right tabular-nums text-muted">{fmtVol(item.volume_24h)}</td>
      )}
      {!isCrypto && <td className="px-3 py-2 text-right text-muted">—</td>}
    </tr>
  );
}

function Section({
  title, badge, items, flashes,
}: {
  title: string;
  badge: string;
  items: MarketItem[];
  flashes: Record<string, "up" | "down" | null>;
}) {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-panel2 border-b border-border sticky top-0 z-10">
        <span className="text-muted text-[11px] uppercase tracking-widest">{title}</span>
        <span className="text-[10px] text-muted/60 bg-panel border border-border px-1.5 rounded">{badge}</span>
      </div>
      <table className="w-full">
        <thead>
          <tr className="text-[11px] text-muted uppercase tracking-wider border-b border-border">
            <th className="px-3 py-1.5 text-left">Symbol</th>
            <th className="px-3 py-1.5 text-left">Name</th>
            <th className="px-3 py-1.5 text-right">Last</th>
            <th className="px-3 py-1.5 text-right">Change</th>
            <th className="px-3 py-1.5 text-right">Chg %</th>
            <th className="px-3 py-1.5 text-right">24h Vol</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-muted text-[11px]">
                Loading…
              </td>
            </tr>
          ) : (
            items.map((item) => (
              <PriceRow key={item.symbol} item={item} flash={flashes[item.symbol] ?? null} />
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function MarketPanel() {
  const [futures, setFutures] = useState<MarketItem[]>([]);
  const [crypto,  setCrypto]  = useState<MarketItem[]>([]);
  const [flashes, setFlashes] = useState<Record<string, "up" | "down" | null>>({});
  const prevRef = useRef<Record<string, number | null>>({});

  function applyFlash(symbol: string, newLast: number | null) {
    const prev = prevRef.current[symbol];
    prevRef.current[symbol] = newLast;
    if (prev != null && newLast != null && newLast !== prev) {
      const dir = newLast > prev ? "up" : "down";
      setFlashes((f) => ({ ...f, [symbol]: dir }));
      setTimeout(() => setFlashes((f) => ({ ...f, [symbol]: null })), 700);
    }
  }

  // load initial data
  useEffect(() => {
    getFutures().then((data: MarketItem[]) => {
      setFutures(data);
      data.forEach((d) => { prevRef.current[d.symbol] = d.last; });
    }).catch(() => {});

    getCrypto().then((data: MarketItem[]) => {
      setCrypto(data);
      data.forEach((d) => { prevRef.current[d.symbol] = d.last; });
    }).catch(() => {});
  }, []);

  // real-time WebSocket
  useEffect(() => {
    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket(MARKET_STREAM_WS());

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as MarketItem & { type?: string };
        if (msg.type === "ping") return;

        applyFlash(msg.symbol, msg.last);

        if (msg.asset_type === "futures") {
          setFutures((prev) => {
            const idx = prev.findIndex((i) => i.symbol === msg.symbol);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = msg;
              return next;
            }
            return [...prev, msg];
          });
        } else {
          setCrypto((prev) => {
            const idx = prev.findIndex((i) => i.symbol === msg.symbol);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = msg;
              return next;
            }
            return [...prev, msg];
          });
        }
      };

      ws.onclose = () => { retryTimer = setTimeout(connect, 3000); };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => { clearTimeout(retryTimer); ws?.close(); };
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* header */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-2 border-b border-border bg-panel">
        <span className="text-[11px] text-muted uppercase tracking-widest">Market Overview</span>
        <span className="text-[10px] text-muted/60">futures · 30s delay · crypto real-time</span>
        <div className="flex-1" />
        <span className="text-[10px] text-muted">
          <span className="text-bull">▲</span> / <span className="text-bear">▼</span> vs prev close (futures) or 24h open (crypto)
        </span>
      </div>

      {/* content */}
      <div className="flex-1 overflow-y-auto">
        <Section title="Futures" badge="yfinance · 30s" items={futures} flashes={flashes} />
        <Section title="Crypto" badge="binance · live" items={crypto}  flashes={flashes} />
      </div>

      {/* footer */}
      <div className="shrink-0 border-t border-border px-3 py-1 flex items-center gap-4 text-[10px] text-muted bg-panel">
        <span>Futures: 15-min delayed · Crypto: real-time via Binance</span>
        <div className="flex-1" />
        <span>{futures.length} futures · {crypto.length} crypto</span>
      </div>
    </div>
  );
}
