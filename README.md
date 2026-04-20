# usefuldataflow (Claude Flow)

A real-time options flow dashboard and data pipeline built by Noah Jones (SWE) and Dalton (trader/design).

## What It Does

- **Options Flow** — streams unusual options trades from Polygon.io WebSocket, scores them with a multi-factor algorithm (premium size, sweep flags, vol/OI ratio, moneyness, DTE, IV)
- **News Feed** — polls 9 RSS sources every 90s, scores articles with Claude Haiku, surfaces high-signal items
- **Price Charts** — historical OHLCV via Polygon REST (1D/5D/1M/3M)
- **Options Chain** — live Greeks, IV, OI, bid/ask via Schwab API
- **Positions** — syncs equity + options positions from Schwab or Robinhood
- **Alerts** — price, IV, and flow-score alerts with real-time WebSocket notifications

## Tech Stack

| Layer | Stack |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy (async), SQLite/PostgreSQL |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Recharts |
| Data | Polygon.io (REST + WS), Schwab API, Robinhood (fallback) |
| AI | Anthropic Claude Haiku (news scoring) |
| Infra | Docker Compose (PostgreSQL + backend + frontend) |

## Polling Intervals

| Source | Interval | Method |
|---|---|---|
| Options trades | Real-time | Polygon WebSocket |
| Open interest / IV | Every 60s | Polygon REST |
| News feeds | Every 90s | RSS + Claude Haiku |
| Alert price checks | Every 30s | Schwab/Polygon REST |

## Getting Started

```bash
# Backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in API keys
uvicorn backend.main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend && npm install && npm run dev
# → http://localhost:5173
```

### Required Environment Variables

```env
POLYGON_API_KEY=        # polygon.io (required)
ANTHROPIC_API_KEY=      # Claude news scoring (optional, falls back to heuristics)
SCHWAB_CLIENT_ID=       # Schwab OAuth (optional)
SCHWAB_CLIENT_SECRET=
ROBINHOOD_USERNAME=     # Robinhood fallback (optional)
ROBINHOOD_PASSWORD=
DATABASE_URL=sqlite+aiosqlite:///./claudeflow.db
```

## Project Structure

```
backend/
  main.py               # FastAPI app entry point
  models/db.py          # SQLAlchemy models
  services/
    flow_detector.py    # Unusual flow scoring algorithm
    polygon.py          # Polygon WebSocket stream manager
    schwab.py           # Schwab API client
    news_feed.py        # RSS polling + AI scoring
    alert_manager.py    # Alert evaluation + broadcast
  routers/              # API endpoints + WebSocket handlers

frontend/src/
  App.tsx               # Root component, tab navigation
  components/
    FlowFeed.tsx        # Real-time flow stream
    FlowStats.tsx       # Hourly heatmap, leaderboard
    OptionsChain.tsx    # Greeks, IV, OI
    PriceChart.tsx      # OHLCV charts (Recharts)
    NewsFeed.tsx        # Scored news items
    PositionsDashboard.tsx
    AlertsPanel.tsx
    Watchlist.tsx
```

## Contributors

- **Noah** — software engineering
- **Dalton** — trading domain expertise & dashboard design
