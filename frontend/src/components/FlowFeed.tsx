import { useEffect, useRef, useState } from "react";
import { getFlow, FLOW_STREAM_WS } from "../api";
import FlowStats from "./FlowStats";

interface Props {
  symbol?: string;
}

interface FlowEvent {
  id: number;
  symbol: string;
  option_type: "call" | "put";
  strike: number;
  expiry: string;
  premium: number;
  size: number;
  price: number;
  open_interest: number;
  volume: number;
  implied_volatility: number;
  is_sweep: boolean;
  flow_score: number;
  flags: string;
  detected_at: string;
  _new?: boolean;
}

// ─── formatting ────────────────────────────────────────────────────────────────

function fmtPremium(p: number) {
  if (p >= 1_000_000) return `$${(p / 1_000_000).toFixed(2)}M`;
  if (p >= 1_000)     return `$${(p / 1_000).toFixed(0)}K`;
  return `$${p.toFixed(0)}`;
}

function fmtVolOI(vol: number, oi: number): string {
  if (!oi) return "—";
  const ratio = vol / oi;
  return `${ratio.toFixed(1)}x`;
}

function parseFlags(raw: string): string[] {
  try { return JSON.parse(raw); } catch { return []; }
}

function scoreClass(score: number) {
  if (score >= 9) return "score-extreme";
  if (score >= 6) return "score-unusual";
  if (score >= 3) return "score-notable";
  return "score-low";
}

function scoreBg(score: number) {
  if (score >= 9) return "bg-extreme/10 border-l-extreme";
  if (score >= 6) return "bg-gold/5    border-l-gold";
  if (score >= 3) return "bg-bull/5    border-l-bull";
  return "border-l-border";
}

function scoreLabel(score: number) {
  if (score >= 9) return "EXTREME";
  if (score >= 6) return "UNUSUAL";
  if (score >= 3) return "NOTABLE";
  return "";
}

// ─── row ───────────────────────────────────────────────────────────────────────

function FlowRow({ ev }: { ev: FlowEvent }) {
  const isCall = ev.option_type === "call";
  const flags  = parseFlags(ev.flags).filter(
    (f) => !f.startsWith("premium_") && !f.startsWith("dte_")
  );
  const exp = ev.expiry ? ev.expiry.slice(5) : "";
  const dte = ev.expiry
    ? Math.max(0, Math.round((new Date(ev.expiry).getTime() - Date.now()) / 86400000))
    : null;

  return (
    <div
      className={`border-l-2 ${scoreBg(ev.flow_score)} border-b border-border
        flex items-center gap-0 text-[11px] tabular-nums
        ${ev._new ? "row-new" : ""}
        hover:bg-panel2 transition-colors cursor-default`}
    >
      {/* ticker */}
      <div className="w-[72px] shrink-0 px-3 py-[5px]">
        <span className="font-bold text-bright">{ev.symbol}</span>
      </div>

      {/* type */}
      <div className="w-[40px] shrink-0 px-1 py-[5px] text-center">
        <span className={`font-semibold ${isCall ? "text-bull" : "text-bear"}`}>
          {isCall ? "C" : "P"}
        </span>
      </div>

      {/* strike */}
      <div className="w-[64px] shrink-0 px-1 py-[5px] text-right text-bright">
        ${ev.strike % 1 === 0 ? ev.strike : ev.strike.toFixed(1)}
      </div>

      {/* expiry */}
      <div className="w-[52px] shrink-0 px-1 py-[5px] text-dim text-[10px]">
        {exp}
      </div>

      {/* DTE */}
      <div className={`w-[36px] shrink-0 px-1 py-[5px] text-right text-[10px]
        ${dte != null && dte <= 7 ? "text-bear" : dte != null && dte <= 30 ? "text-gold" : "text-muted"}`}>
        {dte != null ? `${dte}d` : "—"}
      </div>

      {/* premium */}
      <div className="w-[76px] shrink-0 px-1 py-[5px] text-right font-semibold text-bright">
        {fmtPremium(ev.premium)}
      </div>

      {/* size @ price */}
      <div className="w-[100px] shrink-0 px-1 py-[5px] text-right text-dim">
        {ev.size.toLocaleString()} @ ${ev.price.toFixed(2)}
      </div>

      {/* vol/OI */}
      <div className={`w-[52px] shrink-0 px-1 py-[5px] text-right
        ${ev.open_interest > 0 && ev.volume / ev.open_interest >= 2
          ? "text-gold font-semibold"
          : "text-dim"}`}>
        {fmtVolOI(ev.volume, ev.open_interest)}
      </div>

      {/* IV */}
      <div className="w-[48px] shrink-0 px-1 py-[5px] text-right text-muted text-[10px]">
        {ev.implied_volatility ? `${(ev.implied_volatility * 100).toFixed(0)}%` : "—"}
      </div>

      {/* sweep badge */}
      <div className="w-[52px] shrink-0 px-1 py-[5px] text-center">
        {ev.is_sweep && (
          <span className="text-[9px] font-bold text-gold bg-gold/10 border border-gold/30
                           px-1 py-0.5 rounded tracking-wider">
            SWP
          </span>
        )}
      </div>

      {/* flags */}
      <div className="flex-1 px-1 py-[5px] flex gap-1 flex-wrap min-w-0 overflow-hidden">
        {flags.slice(0, 3).map((f) => (
          <span key={f}
            className="text-[9px] text-muted bg-panel2 border border-border px-1 rounded whitespace-nowrap">
            {f}
          </span>
        ))}
      </div>

      {/* score */}
      <div className={`w-[56px] shrink-0 px-1 py-[5px] text-right`}>
        <span className={`text-[10px] ${scoreClass(ev.flow_score)}`}>
          {ev.flow_score > 0 ? scoreLabel(ev.flow_score) : ""}
        </span>
        <span className={`ml-1 font-bold ${scoreClass(ev.flow_score)}`}>
          {ev.flow_score}
        </span>
      </div>

      {/* time */}
      <div className="w-[52px] shrink-0 px-2 py-[5px] text-right text-muted text-[10px]">
        {new Date(ev.detected_at).toLocaleTimeString([], {
          hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
        })}
      </div>
    </div>
  );
}

// ─── component ─────────────────────────────────────────────────────────────────

type WsStatus = "connecting" | "live" | "offline";

export default function FlowFeed({ symbol }: Props) {
  const [events, setEvents]       = useState<FlowEvent[]>([]);
  const [minScore, setMinScore]   = useState(3);
  const [typeFilter, setTypeFilter] = useState<"" | "call" | "put">("");
  const [sweepOnly, setSweepOnly] = useState(false);
  const [wsStatus, setWsStatus]   = useState<WsStatus>("connecting");
  const [eventCount, setEventCount] = useState(0);
  const [view, setView]           = useState<"list" | "stats">("list");
  const [statsHours, setStatsHours] = useState(24);
  const wsRef = useRef<WebSocket | null>(null);

  // load from DB on mount / filter change
  useEffect(() => {
    getFlow({ symbol: symbol || undefined, min_score: minScore, limit: 200 })
      .then((data: FlowEvent[]) => setEvents(data))
      .catch(() => {});
  }, [symbol, minScore]);

  // live WS
  useEffect(() => {
    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;

    function connect() {
      setWsStatus("connecting");
      ws = new WebSocket(FLOW_STREAM_WS());
      wsRef.current = ws;

      ws.onopen = () => setWsStatus("live");

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as FlowEvent & { type?: string };
        if (msg.type === "ping") return;
        if (msg.flow_score < minScore) return;
        if (typeFilter && msg.option_type !== typeFilter) return;
        if (sweepOnly && !msg.is_sweep) return;
        if (symbol && msg.symbol !== symbol) return;

        setEventCount((c) => c + 1);
        setEvents((prev) => [{ ...msg, _new: true }, ...prev].slice(0, 500));
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
  }, [symbol, minScore, typeFilter, sweepOnly]);

  const displayed = events
    .filter((e) => !typeFilter || e.option_type === typeFilter)
    .filter((e) => !sweepOnly || e.is_sweep)
    .filter((e) => e.flow_score >= minScore);

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── toolbar ── */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-2 border-b border-border bg-panel flex-wrap">

        {/* live indicator */}
        <div className="flex items-center gap-1.5">
          <span className={`live-dot ${wsStatus !== "live" ? wsStatus : ""}`} />
          <span className={`text-[10px] tracking-wider font-medium
            ${wsStatus === "live" ? "text-bull" : wsStatus === "connecting" ? "text-gold" : "text-bear"}`}>
            {wsStatus === "live" ? "LIVE" : wsStatus === "connecting" ? "CONNECTING" : "OFFLINE"}
          </span>
        </div>

        <div className="w-px h-4 bg-border" />

        {/* score filter */}
        <div className="flex items-center gap-1">
          <span className="text-muted text-[10px] mr-1">SCORE</span>
          {[1, 3, 5, 8].map((s) => (
            <button key={s} onClick={() => setMinScore(s)}
              className={`t-btn ${minScore === s ? "active" : ""}`}>
              {s}+
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-border" />

        {/* type filter */}
        <div className="flex gap-1">
          {(["", "call", "put"] as const).map((t) => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`t-btn text-[10px] ${
                typeFilter === t
                  ? t === "call" ? "border-bull text-bull"
                  : t === "put"  ? "border-bear text-bear"
                  : "active"
                  : ""
              }`}>
              {t === "" ? "ALL" : t === "call" ? "CALLS" : "PUTS"}
            </button>
          ))}
        </div>

        <div className="w-px h-4 bg-border" />

        {/* sweep filter */}
        <button onClick={() => setSweepOnly((v) => !v)}
          className={`t-btn text-[10px] ${sweepOnly ? "border-gold text-gold" : ""}`}>
          SWEEPS ONLY
        </button>

        <div className="w-px h-4 bg-border" />

        {/* view toggle */}
        <div className="flex gap-1">
          <button onClick={() => setView("list")}
            className={`t-btn text-[10px] ${view === "list" ? "active" : ""}`}>LIST</button>
          <button onClick={() => setView("stats")}
            className={`t-btn text-[10px] ${view === "stats" ? "active" : ""}`}>STATS</button>
        </div>

        {view === "stats" && (
          <>
            <div className="w-px h-4 bg-border" />
            <div className="flex items-center gap-1">
              <span className="text-muted text-[10px] mr-1">WINDOW</span>
              {[6, 24, 48, 168].map((h) => (
                <button key={h} onClick={() => setStatsHours(h)}
                  className={`t-btn text-[10px] ${statsHours === h ? "active" : ""}`}>
                  {h < 24 ? `${h}h` : h === 168 ? "7d" : `${h / 24}d`}
                </button>
              ))}
            </div>
          </>
        )}

        <div className="flex-1" />

        {/* counters (list view only) */}
        {view === "list" && (
          <div className="flex items-center gap-3 text-[10px] text-muted">
            <span><span className="text-dim">{eventCount}</span> new</span>
            <span><span className="text-dim">{displayed.length}</span> shown</span>
            {symbol && <span className="text-accent">{symbol}</span>}
          </div>
        )}
      </div>

      {view === "stats" ? (
        // ── STATS VIEW ──────────────────────────────────────────────────────────
        <FlowStats hours={statsHours} minScore={minScore} />
      ) : (
        // ── LIST VIEW ───────────────────────────────────────────────────────────
        <>
          {/* column headers */}
          <div className="shrink-0 flex items-center border-b border-border bg-panel2
                          text-[10px] text-muted uppercase tracking-wide">
            <div className="w-[72px] shrink-0 px-3 py-1">Ticker</div>
            <div className="w-[40px] shrink-0 px-1 py-1 text-center">T</div>
            <div className="w-[64px] shrink-0 px-1 py-1 text-right">Strike</div>
            <div className="w-[52px] shrink-0 px-1 py-1">Exp</div>
            <div className="w-[36px] shrink-0 px-1 py-1 text-right">DTE</div>
            <div className="w-[76px] shrink-0 px-1 py-1 text-right">Premium</div>
            <div className="w-[100px] shrink-0 px-1 py-1 text-right">Size @ Px</div>
            <div className="w-[52px] shrink-0 px-1 py-1 text-right">Vol/OI</div>
            <div className="w-[48px] shrink-0 px-1 py-1 text-right">IV</div>
            <div className="w-[52px] shrink-0 px-1 py-1 text-center">Swp</div>
            <div className="flex-1 px-1 py-1">Flags</div>
            <div className="w-[56px] shrink-0 px-1 py-1 text-right">Score</div>
            <div className="w-[52px] shrink-0 px-2 py-1 text-right">Time</div>
          </div>

          {/* rows */}
          <div className="flex-1 overflow-y-auto">
            {displayed.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <span className={`live-dot ${wsStatus !== "live" ? wsStatus : ""}`} />
                <span className="text-muted text-[11px]">
                  {wsStatus === "live"
                    ? `Streaming — waiting for score ≥ ${minScore} flow…`
                    : "Connecting to flow stream…"}
                </span>
              </div>
            ) : (
              displayed.map((ev) => <FlowRow key={`${ev.id}-${ev.detected_at}`} ev={ev} />)
            )}
          </div>

          {/* score legend */}
          <div className="shrink-0 border-t border-border px-3 py-1 flex items-center gap-4
                          text-[10px] text-muted bg-panel">
            <span className="score-notable">● NOTABLE ≥3</span>
            <span className="score-unusual">● UNUSUAL ≥6</span>
            <span className="score-extreme">● EXTREME ≥9</span>
            <div className="flex-1" />
            <span>SWP = IntermarketSweep · Vol/OI = running daily vol ÷ open interest</span>
          </div>
        </>
      )}
    </div>
  );
}
