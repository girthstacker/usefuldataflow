import { useEffect, useRef, useState } from "react";
import { getNews, NEWS_STREAM_WS } from "../api";

const RSS_SOURCE_COUNT = 9; // keep in sync with backend RSS_SOURCES

interface NewsEvent {
  id: number;
  title: string;
  source: string;
  source_type: "news" | "social" | "sec";
  url: string;
  tickers: string[];
  score: number;
  ai_summary: string | null;
  tags: string[];
  published_at: string | null;
  created_at: string | null;
  _new?: boolean;
}

// ── helpers ────────────────────────────────────────────────────────────────────

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60)   return `${Math.round(diff)}s ago`;
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  return `${Math.round(diff / 86400)}d ago`;
}

function typeIcon(t: string) {
  if (t === "sec")    return "🏛️";
  if (t === "social") return "👤";
  return "📰";
}

function scoreBadgeClass(score: number) {
  if (score >= 9) return "bg-bear/20 text-bear border border-bear/40";
  if (score >= 7) return "bg-orange-500/20 text-orange-400 border border-orange-500/40";
  if (score >= 5) return "bg-gold/20 text-gold border border-gold/40";
  return "bg-panel2 text-muted border border-border";
}

// ── row ────────────────────────────────────────────────────────────────────────

function NewsRow({ item }: { item: NewsEvent }) {
  const isSec = item.source_type === "sec";
  const time  = timeAgo(item.published_at || item.created_at);

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`block border-b border-border px-3 py-2 hover:bg-panel2 transition-colors cursor-pointer
        ${item._new ? "row-new" : ""}
        ${isSec ? "border-l-2 border-l-accent" : ""}`}
    >
      <div className="flex items-start gap-2">
        {/* score badge */}
        <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded tabular-nums ${scoreBadgeClass(item.score)}`}>
          {item.score}
        </span>

        {/* type icon */}
        <span className="shrink-0 text-[13px] leading-none mt-0.5" title={item.source_type}>
          {typeIcon(item.source_type)}
        </span>

        {/* body */}
        <div className="flex-1 min-w-0">
          {/* headline */}
          <p className="text-[12px] text-bright font-medium leading-snug line-clamp-2">
            {item.title}
          </p>

          {/* ai summary */}
          {item.ai_summary && (
            <p className="text-[11px] text-dim mt-0.5 leading-snug line-clamp-1">
              {item.ai_summary}
            </p>
          )}

          {/* meta row */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {/* source */}
            <span className="text-[10px] text-muted bg-panel2 border border-border px-1.5 py-0.5 rounded shrink-0">
              {item.source}
            </span>

            {/* ticker pills */}
            {item.tickers.slice(0, 5).map((t) => (
              <span key={t}
                className="text-[10px] text-accent bg-accent/10 border border-accent/30 px-1.5 py-0.5 rounded font-semibold">
                {t}
              </span>
            ))}

            {/* tags */}
            {item.tags.slice(0, 2).map((tag) => (
              <span key={tag}
                className="text-[9px] text-muted border border-border px-1 py-0.5 rounded">
                {tag}
              </span>
            ))}

            <div className="flex-1" />

            {/* time */}
            <span className="text-[10px] text-muted shrink-0">{time}</span>
          </div>
        </div>
      </div>
    </a>
  );
}

// ── component ──────────────────────────────────────────────────────────────────

type TypeFilter = "" | "news" | "social" | "sec";
type WsStatus = "connecting" | "live" | "offline";

export default function NewsFeed() {
  const [items, setItems]         = useState<NewsEvent[]>([]);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("");
  const [tickerFilter, setTickerFilter] = useState("");
  const [tickerInput, setTickerInput] = useState("");
  const [wsStatus, setWsStatus]   = useState<WsStatus>("connecting");
  const [lastPoll, setLastPoll]   = useState<Date | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // collect all unique tickers seen across loaded items for the autocomplete-style filter
  const allTickers = Array.from(
    new Set(items.flatMap((i) => i.tickers))
  ).sort();

  // load history
  useEffect(() => {
    getNews({ type: typeFilter || undefined, ticker: tickerFilter || undefined, limit: 100 })
      .then((data: NewsEvent[]) => setItems(data))
      .catch(() => {});
  }, [typeFilter, tickerFilter]);

  // live WS
  useEffect(() => {
    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;

    function connect() {
      setWsStatus("connecting");
      ws = new WebSocket(NEWS_STREAM_WS());
      wsRef.current = ws;

      ws.onopen = () => setWsStatus("live");

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as NewsEvent & { type?: string; at?: string; sources?: number };
        if (msg.type === "ping") return;
        if (msg.type === "polled") {
          setLastPoll(new Date());
          return;
        }

        // apply current filters in closure — re-create on filter change
        if (typeFilter && msg.source_type !== typeFilter) return;
        if (tickerFilter && !msg.tickers.includes(tickerFilter.toUpperCase())) return;

        setItems((prev) => [{ ...msg, _new: true }, ...prev].slice(0, 300));
      };

      ws.onclose = () => {
        setWsStatus("offline");
        retryTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    }

      connect();
    return () => { clearTimeout(retryTimer); ws?.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, tickerFilter]);

  function applyTickerFilter() {
    setTickerFilter(tickerInput.trim().toUpperCase());
  }

  function clearTickerFilter() {
    setTickerInput("");
    setTickerFilter("");
  }

  // SEC items always show, others filtered by type
  const displayed = items.filter((item) => {
    if (item.source_type === "sec") return true;
    if (typeFilter && item.source_type !== typeFilter) return false;
    return true;
  });

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── toolbar ── */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-2 border-b border-border bg-panel flex-wrap">

        {/* live dot */}
        <div className="flex items-center gap-1.5">
          <span className={`live-dot ${wsStatus !== "live" ? wsStatus : ""}`} />
          <span className={`text-[10px] tracking-wider font-medium
            ${wsStatus === "live" ? "text-bull" : wsStatus === "connecting" ? "text-gold" : "text-bear"}`}>
            {wsStatus === "live" ? "LIVE" : wsStatus === "connecting" ? "CONNECTING" : "OFFLINE"}
          </span>
        </div>

        <div className="w-px h-4 bg-border" />

        {/* type filters */}
        <div className="flex gap-1">
          {(["", "news", "social", "sec"] as const).map((t) => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`t-btn text-[10px] ${typeFilter === t ? "active" : ""}`}>
              {t === "" ? "ALL" : t === "news" ? "📰 NEWS" : t === "social" ? "👤 SOCIAL" : "🏛️ SEC"}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-border" />

        {/* ticker filter */}
        <div className="flex items-center gap-1">
          <input
            className="t-input w-20 uppercase text-[10px]"
            placeholder="ticker…"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && applyTickerFilter()}
          />
          {tickerFilter ? (
            <button className="t-btn text-[10px] border-accent text-accent" onClick={clearTickerFilter}>
              {tickerFilter} ✕
            </button>
          ) : (
            <button className="t-btn text-[10px]" onClick={applyTickerFilter}>GO</button>
          )}
        </div>

        {/* quick-select from seen tickers */}
        {allTickers.length > 0 && !tickerFilter && (
          <div className="flex gap-1 flex-wrap max-w-xs">
            {allTickers.slice(0, 8).map((t) => (
              <button key={t}
                onClick={() => { setTickerInput(t); setTickerFilter(t); }}
                className="text-[9px] text-accent bg-accent/10 border border-accent/20 px-1.5 py-0.5 rounded hover:bg-accent/20 transition-colors">
                {t}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1" />

        <span className="text-[10px] text-muted shrink-0">
          <span className="text-dim">{displayed.length}</span> items · polls every 90s
        </span>
      </div>

      {/* ── score legend ── */}
      <div className="shrink-0 flex items-center gap-4 px-3 py-1 border-b border-border bg-panel2 text-[10px]">
        <span className="text-muted">SCORE</span>
        <span className="bg-panel2 text-muted border border-border px-1.5 rounded">3-4 low</span>
        <span className="bg-gold/20 text-gold border border-gold/40 px-1.5 rounded">5-6 relevant</span>
        <span className="bg-orange-500/20 text-orange-400 border border-orange-500/40 px-1.5 rounded">7-8 significant</span>
        <span className="bg-bear/20 text-bear border border-bear/40 px-1.5 rounded">9-10 breaking</span>
        <span className="text-muted ml-2">🏛️ SEC items always shown</span>
      </div>

      {/* ── feed ── */}
      <div className="flex-1 overflow-y-auto">
        {displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2">
            <span className={`live-dot ${wsStatus !== "live" ? wsStatus : ""}`} />
            <span className="text-muted text-[11px]">
              {wsStatus === "live"
                ? "Waiting for news items (polls every 90s)…"
                : "Connecting to news stream…"}
            </span>
          </div>
        ) : (
          displayed.map((item) => <NewsRow key={`${item.id}-${item.url}`} item={item} />)
        )}
      </div>

      {/* ── footer ── */}
      <div className="shrink-0 border-t border-border px-3 py-1 flex items-center gap-4 text-[10px] text-muted bg-panel">
        <span>{displayed.length} items shown · score ≥ 3 · SEC always shown</span>
        <div className="flex-1" />
        <span>
          last poll:{" "}
          {lastPoll ? (
            <span className="text-dim font-mono">
              {lastPoll.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
            </span>
          ) : (
            <span className="text-muted/60">waiting…</span>
          )}
        </span>
        <span className="text-muted/60">· every 90s · {RSS_SOURCE_COUNT} sources</span>
      </div>
    </div>
  );
}
