import { useEffect, useState } from "react";
import Watchlist from "./components/Watchlist";
import NewsFeed from "./components/NewsFeed";
import PriceChart from "./components/PriceChart";
import OptionsChain from "./components/OptionsChain";
import FlowFeed from "./components/FlowFeed";
import PositionsDashboard from "./components/PositionsDashboard";
import AlertsPanel from "./components/AlertsPanel";
import MarketPanel from "./components/MarketPanel";
import { getStreamStatus, getAuthStatus } from "./api";

type Tab = "watchlist" | "news" | "chart" | "chain" | "flow" | "positions" | "alerts" | "market";

const TABS: { id: Tab; label: string; key: string }[] = [
  { id: "watchlist", label: "WATCHLIST", key: "1" },
  { id: "news",      label: "NEWS",      key: "2" },
  { id: "chart",     label: "CHART",     key: "3" },
  { id: "chain",     label: "CHAIN",     key: "4" },
  { id: "flow",      label: "FLOW FEED", key: "5" },
  { id: "positions", label: "POSITIONS", key: "6" },
  { id: "alerts",    label: "ALERTS",    key: "7" },
  { id: "market",    label: "MARKET",    key: "8" },
];

function useETClock() {
  const [time, setTime] = useState("");
  useEffect(() => {
    const tick = () =>
      setTime(
        new Date().toLocaleTimeString("en-US", {
          timeZone: "America/New_York",
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

function isMarketOpen(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  return day >= 1 && day <= 5 && mins >= 570 && mins < 960;
}

function isPreMarket(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  return day >= 1 && day <= 5 && mins >= 240 && mins < 570; // 4:00–9:30
}

function isAfterHours(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  return day >= 1 && day <= 5 && mins >= 960 && mins < 1200; // 16:00–20:00
}

interface SchwabStatus {
  linked: boolean;
  access_valid?: boolean;
  reason?: string;
}

export default function App() {
  const [tab, setTab]               = useState<Tab>("flow");
  const [symbol, setSymbol]         = useState("SPY");
  const [symbolInput, setSymbolInput] = useState("SPY");
  const [streamWatching, setStreamWatching] = useState<string[]>([]);
  const [schwabStatus, setSchwabStatus] = useState<SchwabStatus | null>(null);
  const clock = useETClock();
  const open  = isMarketOpen();
  const pre   = isPreMarket();
  const after = isAfterHours();

  const sessionLabel = open ? "MKT OPEN" : pre ? "PRE-MKT" : after ? "AFTER-HRS" : "MKT CLOSED";
  const sessionColor = open ? "text-bull" : pre || after ? "text-gold" : "text-muted";

  // poll stream status
  useEffect(() => {
    function poll() {
      getStreamStatus()
        .then((s) => setStreamWatching(s.watching ?? []))
        .catch(() => {});
    }
    poll();
    const id = setInterval(poll, 30_000);
    return () => clearInterval(id);
  }, []);

  // poll auth status
  useEffect(() => {
    function poll() {
      getAuthStatus()
        .then((s) => setSchwabStatus(s.schwab))
        .catch(() => {});
    }
    poll();
    const id = setInterval(poll, 60_000);
    return () => clearInterval(id);
  }, []);

  // keyboard shortcuts — 1-6 for tabs, ignore when typing in an input
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) return;
      const t = TABS.find((t) => t.key === e.key);
      if (t) { e.preventDefault(); setTab(t.id); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  function commitSymbol(raw: string) {
    const s = raw.trim().toUpperCase();
    if (s) { setSymbol(s); setSymbolInput(s); }
  }

  // Schwab indicator
  const schwabLabel = schwabStatus == null
    ? ""
    : schwabStatus.linked && schwabStatus.access_valid
      ? "SCHWAB ✓"
      : schwabStatus.linked
        ? "SCHWAB ⚠"
        : "SCHWAB —";
  const schwabColor = schwabStatus?.linked && schwabStatus?.access_valid
    ? "text-bull"
    : schwabStatus?.linked
      ? "text-gold"
      : "text-muted";

  return (
    <div className="h-full flex flex-col bg-surface overflow-hidden">

      {/* ── header ── */}
      <header className="shrink-0 bg-panel border-b border-border flex items-center px-3 gap-4 h-9">
        <span className="text-accent font-bold tracking-[0.2em] text-[12px] shrink-0">
          ◈ CLAUDE FLOW
        </span>

        <div className="w-px h-4 bg-border shrink-0" />

        {/* global symbol input */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-muted text-[11px]">SYM</span>
          <input
            className="t-input w-16 uppercase"
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && commitSymbol(symbolInput)}
            onBlur={() => commitSymbol(symbolInput)}
          />
        </div>

        <div className="w-px h-4 bg-border shrink-0" />

        {/* tab nav */}
        <nav className="flex gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              title={`Press ${t.key}`}
              className={`px-3 py-1 text-[11px] tracking-wider rounded transition-colors ${
                tab === t.id
                  ? "bg-panel2 text-bright border border-border2"
                  : "text-muted hover:text-dim"
              }`}
            >
              {t.label}
              <span className="ml-1 text-[8px] text-muted/60">[{t.key}]</span>
            </button>
          ))}
        </nav>

        <div className="flex-1" />

        {/* stream status */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted shrink-0 max-w-xs overflow-hidden">
          <span className="shrink-0">STREAM</span>
          <span className="text-dim truncate">
            {streamWatching.slice(0, 5).join(" · ")}
            {streamWatching.length > 5 ? ` +${streamWatching.length - 5}` : ""}
          </span>
        </div>

        <div className="w-px h-4 bg-border shrink-0" />

        {/* market session */}
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[11px] ${sessionColor}`}>{sessionLabel}</span>
          <span className="text-dim text-[11px] font-mono tabular-nums">{clock} ET</span>
        </div>
      </header>

      {/* ── main content ── */}
      <main className="flex-1 overflow-hidden">
        {tab === "watchlist" && (
          <Watchlist
            onSelectSymbol={(s) => {
              commitSymbol(s);
              setTab("chart");
            }}
          />
        )}
        {tab === "news"      && <NewsFeed />}
        {tab === "chart"     && <PriceChart symbol={symbol} />}
        {tab === "chain"     && <OptionsChain symbol={symbol} onSymbolChange={commitSymbol} />}
        {tab === "flow"      && <FlowFeed symbol={undefined} />}
        {tab === "positions" && <PositionsDashboard />}
        {tab === "alerts"    && <AlertsPanel symbol={symbol} />}
        {tab === "market"    && <MarketPanel />}
      </main>

      {/* ── status bar ── */}
      <footer className="shrink-0 bg-panel border-t border-border flex items-center px-3 h-5 gap-4">
        <span className="text-muted text-[11px]">
          CLAUDE FLOW v0.1 · python · polygon.io
        </span>

        <div className="w-px h-3 bg-border" />

        {/* auth status */}
        {schwabLabel && (
          <span className={`text-[11px] ${schwabColor}`}>{schwabLabel}</span>
        )}

        <div className="flex-1" />

        <span className="text-muted text-[11px]">
          keys: 1-8 tabs
        </span>

        <div className="w-px h-3 bg-border" />

        <span className="text-muted text-[11px]">
          {new Date().toLocaleDateString("en-US", {
            weekday: "short", month: "short", day: "numeric", year: "numeric",
          })}
        </span>
      </footer>
    </div>
  );
}
