import { useEffect, useRef } from "react";

declare global {
  interface Window { TradingView: any; }
}

interface Props { symbol: string; }

const TV_SCRIPT = "https://s3.tradingview.com/tv.js";

const FUTURES_MAP: Record<string, string> = {
  "ES=F": "CME_MINI:ES1!", "NQ=F": "CME_MINI:NQ1!", "YM=F": "CBOT_MINI:YM1!",
  "RTY=F": "CME_MINI:RTY1!", "CL=F": "NYMEX:CL1!", "GC=F": "COMEX:GC1!",
  "SI=F": "COMEX:SI1!", "ZN=F": "CBOT:ZN1!",
  "BTC-USD": "COINBASE:BTCUSD", "ETH-USD": "COINBASE:ETHUSD",
  "SOL-USD": "COINBASE:SOLUSD", "BNB-USD": "BINANCE:BNBUSDT",
  "XRP-USD": "COINBASE:XRPUSD",
};

function tvSymbol(raw: string) {
  return FUTURES_MAP[raw.toUpperCase()] ?? raw.toUpperCase();
}

export default function PriceChart({ symbol }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ready        = useRef(false);

  function build(sym: string) {
    if (!containerRef.current || !window.TradingView) return;
    containerRef.current.innerHTML = `<div id="tv_adv" style="height:100%;width:100%"></div>`;
    new window.TradingView.widget({
      container_id:          "tv_adv",
      autosize:              true,
      symbol:                tvSymbol(sym),
      interval:              "D",
      timezone:              "America/New_York",
      theme:                 "dark",
      style:                 "1",
      locale:                "en",
      toolbar_bg:            "#0d1117",
      backgroundColor:       "#080b0f",
      enable_publishing:     false,
      allow_symbol_change:   true,
      save_image:            true,
      hide_top_toolbar:      false,
      hide_side_toolbar:     false,
      hide_legend:           false,
      withdateranges:        true,
      details:               true,
      hotlist:               true,
      calendar:              true,
      show_popup_button:     true,
      popup_width:           "1200",
      popup_height:          "800",
    });
  }

  useEffect(() => {
    if (window.TradingView) { ready.current = true; build(symbol); return; }
    if (document.querySelector(`script[src="${TV_SCRIPT}"]`)) return;
    const s = document.createElement("script");
    s.src = TV_SCRIPT;
    s.async = true;
    s.onload = () => { ready.current = true; build(symbol); };
    document.head.appendChild(s);
  }, []);

  useEffect(() => { if (ready.current) build(symbol); }, [symbol]);

  return <div ref={containerRef} className="h-full w-full" />;
}
