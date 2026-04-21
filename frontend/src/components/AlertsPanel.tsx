import { useEffect, useRef, useState } from "react";
import { getAlerts, createAlert, updateAlert, deleteAlert, ALERTS_WS } from "../api";

interface Props {
  symbol: string;
}

type Condition = "above" | "below" | "percent_change" | "iv_above" | "flow_score_above";

interface AlertRow {
  id: number;
  symbol: string;
  condition: Condition;
  threshold: number;
  message: string | null;
  active: boolean;
  triggered: boolean;
  triggered_at: string | null;
}

interface TriggerMsg {
  type: "trigger";
  id: number;
  symbol: string;
  condition: Condition;
  threshold: number;
  value: number;
  message: string | null;
  triggered_at: string;
}

// ── audio ──────────────────────────────────────────────────────────────────────

function playBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    // AudioContext blocked — no-op
  }
}

// ── formatting ─────────────────────────────────────────────────────────────────

const CONDITION_LABELS: Record<Condition, string> = {
  above:            "price above",
  below:            "price below",
  percent_change:   "% change ≥",
  iv_above:         "IV above",
  flow_score_above: "flow score ≥",
};

const CONDITIONS: Condition[] = ["above", "below", "percent_change", "iv_above", "flow_score_above"];

function conditionPlaceholder(c: Condition): string {
  if (c === "percent_change") return "e.g. 5 (%)";
  if (c === "iv_above") return "e.g. 0.5 (50% IV)";
  if (c === "flow_score_above") return "e.g. 6";
  return "price";
}

function formatThreshold(c: Condition, t: number): string {
  if (c === "percent_change") return `${t}%`;
  if (c === "iv_above") return `${(t * 100).toFixed(0)}% IV`;
  if (c === "flow_score_above") return `score ${t}+`;
  return `$${t}`;
}

// ── sub-components ─────────────────────────────────────────────────────────────

function FlashBanner({ trigger, onDismiss }: { trigger: TriggerMsg; onDismiss: () => void }) {
  const isCall = trigger.condition === "flow_score_above";
  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2.5 bg-gold/10 border-b border-gold/40
                    text-[12px] animate-pulse">
      <span className="text-gold font-bold tracking-wider">ALERT TRIGGERED</span>
      <span className="text-bright font-semibold">{trigger.symbol}</span>
      <span className="text-dim">{CONDITION_LABELS[trigger.condition]}</span>
      <span className="text-gold font-mono">{formatThreshold(trigger.condition, trigger.threshold)}</span>
      {trigger.message && <span className="text-muted">{trigger.message}</span>}
      <div className="flex-1" />
      <span className="text-muted text-[11px]">
        {new Date(trigger.triggered_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
      </span>
      <button onClick={onDismiss} className="text-muted hover:text-bright text-[11px] ml-1">✕</button>
    </div>
  );
}

function AlertItem({ a, onToggle, onDelete }: {
  a: AlertRow;
  onToggle: (id: number, active: boolean) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className={`flex items-center gap-2 text-[12px] border-b border-border tabular-nums
      ${a.triggered ? "bg-gold/5" : ""}
      ${!a.active ? "opacity-40" : "hover:bg-panel2/50"}
      transition-colors`}>
      <div className="w-[72px] shrink-0 px-3 py-[5px] font-bold text-bright">{a.symbol}</div>
      <div className="w-[140px] shrink-0 px-1 py-[5px] text-dim">{CONDITION_LABELS[a.condition]}</div>
      <div className="w-[80px] shrink-0 px-1 py-[5px] text-right text-bright font-mono">
        {formatThreshold(a.condition, a.threshold)}
      </div>
      <div className="flex-1 px-1 py-[5px] text-muted truncate">{a.message ?? ""}</div>

      {a.triggered && (
        <div className="shrink-0 px-2 py-[5px] text-gold text-[11px] whitespace-nowrap">
          ✓ {a.triggered_at
            ? new Date(a.triggered_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
            : "triggered"}
        </div>
      )}

      <div className="shrink-0 px-1 py-[5px]">
        <button
          onClick={() => onToggle(a.id, a.active)}
          className={`t-btn text-[11px] ${a.active ? "border-bull text-bull" : ""}`}>
          {a.active ? "ON" : "OFF"}
        </button>
      </div>

      <div className="shrink-0 px-2 py-[5px]">
        <button onClick={() => onDelete(a.id)} className="text-muted hover:text-bear text-[11px] leading-none">✕</button>
      </div>
    </div>
  );
}

// ── component ──────────────────────────────────────────────────────────────────

export default function AlertsPanel({ symbol }: Props) {
  const [alerts, setAlerts]       = useState<AlertRow[]>([]);
  const [flash, setFlash]         = useState<TriggerMsg | null>(null);
  const [wsStatus, setWsStatus]   = useState<"connecting" | "live" | "offline">("connecting");
  const [saving, setSaving]       = useState(false);
  const [form, setForm]           = useState({
    symbol,
    condition: "above" as Condition,
    threshold: "",
    message: "",
  });
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => { setForm((f) => ({ ...f, symbol })); }, [symbol]);

  async function load() {
    try { setAlerts(await getAlerts()); } catch { /* offline */ }
  }

  useEffect(() => { load(); }, []);

  // WS connection
  useEffect(() => {
    let ws: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;

    function connect() {
      setWsStatus("connecting");
      ws = new WebSocket(ALERTS_WS());
      wsRef.current = ws;
      ws.onopen = () => setWsStatus("live");
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "ping") return;
        if (msg.type === "trigger") {
          playBeep();
          setFlash(msg as TriggerMsg);
          setAlerts((prev) =>
            prev.map((a) => a.id === msg.id ? { ...a, triggered: true, triggered_at: msg.triggered_at } : a)
          );
        }
      };
      ws.onclose = () => {
        setWsStatus("offline");
        retryTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws.close();
    }

    connect();
    return () => { clearTimeout(retryTimer); ws?.close(); };
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.threshold) return;
    setSaving(true);
    try {
      const created: AlertRow = await createAlert({
        symbol: form.symbol.trim().toUpperCase(),
        condition: form.condition,
        threshold: parseFloat(form.threshold),
        message: form.message || undefined,
      });
      setAlerts((prev) => [created, ...prev]);
      setForm((f) => ({ ...f, threshold: "", message: "" }));
    } catch {
      // backend error
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(id: number, active: boolean) {
    try {
      const updated: AlertRow = await updateAlert(id, { active: !active });
      setAlerts((prev) => prev.map((a) => a.id === id ? updated : a));
    } catch { /* offline */ }
  }

  async function handleDelete(id: number) {
    try {
      await deleteAlert(id);
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch { /* offline */ }
  }

  const active   = alerts.filter((a) => a.active && !a.triggered);
  const triggered = alerts.filter((a) => a.triggered);
  const inactive  = alerts.filter((a) => !a.active && !a.triggered);

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* flash banner */}
      {flash && <FlashBanner trigger={flash} onDismiss={() => setFlash(null)} />}

      {/* toolbar / create form */}
      <div className="shrink-0 border-b border-border bg-panel px-3 py-2">
        <form onSubmit={handleCreate} className="flex items-center gap-2 flex-wrap">
          {/* symbol */}
          <input
            className="t-input w-16 uppercase"
            placeholder="TKR"
            value={form.symbol}
            onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value.toUpperCase() }))}
            required
          />

          {/* condition */}
          <select
            className="t-input text-[12px] bg-surface"
            value={form.condition}
            onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value as Condition }))}
          >
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
            ))}
          </select>

          {/* threshold */}
          <input
            className="t-input w-24 font-mono"
            placeholder={conditionPlaceholder(form.condition)}
            value={form.threshold}
            onChange={(e) => setForm((f) => ({ ...f, threshold: e.target.value }))}
            type="number"
            step="any"
            required
          />

          {/* note */}
          <input
            className="t-input flex-1 min-w-[120px]"
            placeholder="note (optional)"
            value={form.message}
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
          />

          <button type="submit" disabled={saving} className="t-btn text-[11px] border-accent text-accent">
            {saving ? "saving…" : "+ ADD"}
          </button>
        </form>
      </div>

      {/* WS status bar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-border bg-panel2 text-[11px]">
        <span className={`live-dot ${wsStatus !== "live" ? wsStatus : ""}`} />
        <span className={wsStatus === "live" ? "text-bull" : wsStatus === "connecting" ? "text-gold" : "text-bear"}>
          {wsStatus === "live" ? "LIVE" : wsStatus === "connecting" ? "CONNECTING" : "OFFLINE"}
        </span>
        <div className="flex-1" />
        <span className="text-muted">
          {active.length} active · {triggered.length} triggered · {inactive.length} paused
        </span>
      </div>

      {/* column headers */}
      <div className="shrink-0 flex text-[10px] text-muted uppercase tracking-wide bg-panel2 border-b border-border">
        <div className="w-[72px] shrink-0 px-3 py-1">Symbol</div>
        <div className="w-[140px] shrink-0 px-1 py-1">Condition</div>
        <div className="w-[80px] shrink-0 px-1 py-1 text-right">Threshold</div>
        <div className="flex-1 px-1 py-1">Note</div>
        <div className="w-[80px] shrink-0 px-1 py-1 text-right">Status</div>
        <div className="w-[56px] shrink-0 px-1 py-1 text-center">Toggle</div>
        <div className="w-8 shrink-0 px-2 py-1" />
      </div>

      {/* rows */}
      <div className="flex-1 overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted text-[12px]">
            No alerts configured — create one above
          </div>
        ) : (
          <>
            {triggered.map((a) => <AlertItem key={a.id} a={a} onToggle={handleToggle} onDelete={handleDelete} />)}
            {active.map((a) => <AlertItem key={a.id} a={a} onToggle={handleToggle} onDelete={handleDelete} />)}
            {inactive.map((a) => <AlertItem key={a.id} a={a} onToggle={handleToggle} onDelete={handleDelete} />)}
          </>
        )}
      </div>

      {/* legend */}
      <div className="shrink-0 border-t border-border px-3 py-1 flex gap-4 text-[11px] text-muted bg-panel">
        <span className="text-bull">■ active</span>
        <span className="text-gold">■ triggered</span>
        <span className="text-dim">■ paused</span>
        <div className="flex-1" />
        <span>Toggle ON re-arms · IV value 0–1 (0.5 = 50%)</span>
      </div>
    </div>
  );
}
