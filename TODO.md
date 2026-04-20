# Claude Flow — To Do

## In Progress
- [ ] **News feed tuning** — score threshold temporarily lowered to 3 to populate feed; raise back to 5 once we confirm items are flowing and Claude scoring is working
- [ ] **Schwab OAuth** — `schwab_auth.py` scaffolded, token read/write works, but full OAuth flow needs end-to-end test with real Schwab credentials

---

## Up Next
- [ ] **Positions sync** — Schwab positions endpoint wired but untested; need live account to verify `GET /positions/sync/schwab` pulls real data
- [ ] **Alert notifications** — backend triggers fire and broadcast over WS, but no browser push notification or sound for the news tab yet (flow tab has a beep)
- [ ] **News ticker filter persistence** — ticker filter resets on page refresh; store in localStorage or URL param
- [ ] **Chart symbol persistence** — selected symbol resets on refresh; persist in localStorage

---

## Backlog
- [ ] **Robinhood integration** — credentials wired into config, `robinhood.py` scaffolded, needs `robin_stocks` calls for positions sync
- [ ] **Options chain — live greeks** — chain currently shows snapshot IV/delta from Polygon; add real-time greek streaming
- [ ] **Watchlist persistence** — symbols added in the UI are lost on refresh; save to DB (WatchlistItem model exists, just not wired to the UI add/remove)
- [ ] **News feed — more sources** — Seeking Alpha sometimes rate-limits; investigate and add fallback sources
- [ ] **Flow stats — export** — add CSV download button to the STATS view
- [ ] **Dark/light theme toggle** — currently hardcoded dark
- [ ] **Mobile layout** — not responsive at all right now

---

## Done ✓
- [x] Polygon WebSocket options flow streaming
- [x] Flow detector with scoring, flags, sweep detection
- [x] Flow feed — live list view + stats view (leaderboard, hourly chart, top trades)
- [x] Price chart — AreaChart + volume BarChart, 1D/5D/1M/3M ranges, sparklines in watchlist
- [x] Options chain — Polygon snapshot, exp/strike filters, call/put split
- [x] Watchlist — live quotes every 5s, bid/ask/change/vol, sparklines
- [x] Positions dashboard — manual + Schwab/Robinhood sync buttons
- [x] Alerts panel — CRUD, ABOVE/BELOW/IV_ABOVE/FLOW_SCORE_ABOVE conditions, live WS triggers
- [x] News feed — 9 RSS sources, Claude Haiku scoring, SEC always shown, live WS stream, filter bar, last poll timestamp
- [x] Schwab auth status indicator in footer
- [x] Keyboard shortcuts (1–7) for tab switching
- [x] ET clock + market session label (pre/regular/after hours)
- [x] DB schema — all models in SQLAlchemy, SQLite default, async
