"""
News feed manager — polls RSS/Atom sources every 90 s, scores with Claude Haiku,
persists relevant items (score ≥ 3) and streams them to WebSocket clients.
"""
import asyncio
import html
import json
import logging
import re
from datetime import datetime, timedelta

from backend.config import settings

logger = logging.getLogger(__name__)

# ── sources ────────────────────────────────────────────────────────────────────

RSS_SOURCES = [
    # Market news
    {"name": "Yahoo Finance",     "url": "https://finance.yahoo.com/news/rssindex",                                                                           "type": "news"},
    {"name": "CNBC Markets",      "url": "https://www.cnbc.com/id/20910258/device/rss/rss.html",                                                              "type": "news"},
    {"name": "MarketWatch",       "url": "https://feeds.marketwatch.com/marketwatch/topstories",                                                               "type": "news"},
    {"name": "Benzinga",          "url": "https://www.benzinga.com/feed",                                                                                      "type": "news"},
    {"name": "Seeking Alpha",     "url": "https://seekingalpha.com/market_currents.xml",                                                                      "type": "news"},
    {"name": "Investing.com",     "url": "https://www.investing.com/rss/news.rss",                                                                            "type": "news"},
    # Accounts / analysis
    {"name": "Unusual Whales",    "url": "https://unusualwhales.substack.com/feed",                                                                           "type": "social"},
    {"name": "WSJ Markets",       "url": "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",                                                                    "type": "social"},
    # Regulatory
    {"name": "SEC EDGAR 8-K",     "url": "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&dateb=&owner=include&count=10&output=atom",     "type": "sec"},
    # High-priority political
    {"name": "Trump / Google News",  "url": "https://news.google.com/rss/search?q=Trump+tariff+OR+trade+OR+market+OR+stock+OR+economy+OR+crypto&hl=en-US&gl=US&ceid=US:en", "type": "social"},
]

TRUMP_SOURCES = {"Trump / Google News"}

# Words that look like tickers but aren't
_EXCLUDE = frozenset({
    "A", "I", "AM", "AN", "AS", "AT", "BE", "BY", "DO", "GO", "IN",
    "IS", "IT", "NO", "OF", "ON", "OR", "SO", "TO", "UP", "US", "WE",
    "ALL", "AND", "ARE", "BUT", "CAN", "DID", "FOR", "GET", "GOT",
    "HAD", "HAS", "HIM", "HIS", "HOW", "ITS", "LET", "MAY", "NEW",
    "NOT", "NOW", "OUR", "OUT", "OWN", "SAY", "SET", "THE", "TOP",
    "TWO", "USE", "WAS", "WAY", "WHO", "WHY", "YET", "YOU",
    "WILL", "WITH", "BEEN", "FROM", "HAVE", "INTO", "JUST", "ONLY",
    "OVER", "SAID", "THAN", "THAT", "THEM", "THEN", "THEY", "THIS",
    "WERE", "WHAT", "WHEN",
    # Financial acronyms that aren't tickers
    "CEO", "CFO", "COO", "CTO", "IPO", "ETF", "USD", "EUR", "GBP",
    "GDP", "CPI", "PPI", "PCE", "FED", "SEC", "DOJ", "FDA", "IRS",
    "IMF", "ECB", "BOJ", "RBI", "ESG", "PE", "EPS", "TTM", "YTD",
    "YOY", "QOQ", "MOM", "ATH", "ATL", "RSI", "EMA", "SMA", "VWAP",
})


def _clean_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return " ".join(text.split())


def _parse_published(entry) -> datetime:
    if hasattr(entry, "published_parsed") and entry.published_parsed:
        try:
            from time import mktime
            return datetime.utcfromtimestamp(mktime(entry.published_parsed))
        except Exception:
            pass
    return datetime.utcnow()


# ── manager ────────────────────────────────────────────────────────────────────

class NewsFeedManager:
    def __init__(self) -> None:
        self._queues: list[asyncio.Queue] = []
        self._poll_task: asyncio.Task | None = None
        self._running = False
        self._seen_urls: set[str] = set()
        self._watchlist: list[str] = []
        self._claude_sem = asyncio.Semaphore(4)  # max concurrent scoring calls
        self._anthropic = None

    # ── lifecycle ──────────────────────────────────────────────────────────────

    async def start(self, watchlist: list[str] | None = None) -> None:
        if self._running:
            return
        self._running = True
        if watchlist:
            self._watchlist = [s.upper() for s in watchlist]

        # Warm seen-URL cache from DB to avoid re-processing on restart
        try:
            from backend.models.db import SessionLocal, NewsItem
            from sqlalchemy import select as sa_select
            async with SessionLocal() as db:
                urls = (await db.execute(sa_select(NewsItem.url))).scalars().all()
                self._seen_urls.update(urls)
            logger.info("NewsFeedManager: loaded %d seen URLs from DB", len(self._seen_urls))
        except Exception as exc:
            logger.warning("NewsFeedManager: could not warm URL cache: %s", exc)

        # Init Anthropic client if key is available
        if settings.ANTHROPIC_API_KEY:
            try:
                import anthropic
                self._anthropic = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY)
                logger.info("NewsFeedManager: Anthropic client ready")
            except ImportError:
                logger.warning("anthropic package not installed — install with: pip install anthropic")

        self._poll_task = asyncio.create_task(self._poll_loop(), name="news-poll")
        logger.info("NewsFeedManager started, watchlist: %s", self._watchlist[:8])

    async def stop(self) -> None:
        self._running = False
        if self._poll_task:
            self._poll_task.cancel()
            try:
                await self._poll_task
            except asyncio.CancelledError:
                pass

    def update_watchlist(self, symbols: list[str]) -> None:
        self._watchlist = [s.upper() for s in symbols]

    # ── subscriptions ──────────────────────────────────────────────────────────

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._queues.append(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        try:
            self._queues.remove(q)
        except ValueError:
            pass

    # ── poll loop ──────────────────────────────────────────────────────────────

    async def _poll_loop(self) -> None:
        await self._poll_all()          # immediate first poll
        while self._running:
            await asyncio.sleep(90)
            await self._poll_all()

    async def _poll_all(self) -> None:
        try:
            import feedparser as _fp  # noqa: F401
        except ImportError:
            logger.warning("feedparser not installed — pip install feedparser")
            return

        tasks = [self._process_source(src) for src in RSS_SOURCES]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for src, result in zip(RSS_SOURCES, results):
            if isinstance(result, Exception):
                logger.warning("Feed error [%s]: %s", src["name"], result)

        await self._broadcast({"type": "polled", "at": datetime.utcnow().isoformat(), "sources": len(RSS_SOURCES)})

    async def _process_source(self, source: dict) -> None:
        import feedparser
        loop = asyncio.get_event_loop()

        # SEC requires an identified User-Agent; use it for all sources to avoid blocks
        headers = {"User-Agent": "ClaudeFlow/1.0 ddavis7999@gmail.com"}

        def _fetch():
            return feedparser.parse(source["url"], request_headers=headers)

        try:
            parsed = await asyncio.wait_for(
                loop.run_in_executor(None, _fetch),
                timeout=20.0,
            )
        except (asyncio.TimeoutError, Exception) as exc:
            logger.warning("feedparser error [%s]: %s", source["name"], exc)
            return

        cutoff = datetime.utcnow() - timedelta(hours=48)  # skip very old items

        for entry in (parsed.entries or [])[:15]:
            url = getattr(entry, "link", None) or getattr(entry, "id", None)
            if not url or url in self._seen_urls:
                continue

            title   = _clean_html(getattr(entry, "title",   "") or "")[:500]
            summary = _clean_html(getattr(entry, "summary", "") or "")[:600]
            if not title:
                continue

            published_at = _parse_published(entry)
            if published_at < cutoff:
                self._seen_urls.add(url)  # mark old as seen, don't process
                continue

            self._seen_urls.add(url)

            text    = f"{title} {summary}".upper()
            tickers = self._detect_tickers(text)

            item = {
                "title":       title,
                "source":      source["name"],
                "source_type": source["type"],
                "url":         url,
                "published_at": published_at,
                "raw_summary": summary,
                "tickers":     tickers,
            }

            asyncio.create_task(self._score_and_persist(item))

    # ── ticker detection ───────────────────────────────────────────────────────

    def _detect_tickers(self, text: str) -> list[str]:
        found: set[str] = set()

        # 1. Watchlist tickers (exact word boundary)
        for sym in self._watchlist:
            if re.search(r"\b" + re.escape(sym) + r"\b", text):
                found.add(sym)

        # 2. $TICKER patterns
        for t in re.findall(r"\$([A-Z]{1,5})\b", text):
            if t not in _EXCLUDE and len(t) >= 2:
                found.add(t)

        return sorted(found)

    # ── scoring ────────────────────────────────────────────────────────────────

    async def _score_and_persist(self, item: dict) -> None:
        is_sec = item["source_type"] == "sec"
        is_trump = item["source"] in TRUMP_SOURCES

        if is_trump:
            scored = {"score": 10, "summary": "Trump post — potential market impact.", "tags": ["trump", "geopolitical"]}
        elif self._anthropic:
            try:
                async with self._claude_sem:
                    scored = await self._score_with_claude(item)
            except Exception as exc:
                logger.debug("Claude scoring failed for '%s': %s", item["title"][:60], exc)
                scored = self._fallback_score(item)
        else:
            scored = self._fallback_score(item)

        score = scored.get("score", 0)
        if score < 3 and not is_sec:
            return

        db_item = {
            "title":       item["title"],
            "source":      item["source"],
            "source_type": item["source_type"],
            "url":         item["url"],
            "tickers":     json.dumps(item["tickers"]),
            "score":       score,
            "ai_summary":  (scored.get("summary") or "")[:400],
            "tags":        json.dumps(scored.get("tags", [])),
            "published_at": item["published_at"],
        }

        from backend.models.db import SessionLocal, NewsItem
        try:
            async with SessionLocal() as db:
                news = NewsItem(**db_item)
                db.add(news)
                await db.commit()
                await db.refresh(news)
                row_id = news.id
        except Exception as exc:
            if "UNIQUE" in str(exc).upper():
                return
            logger.error("news persist error: %s", exc)
            return

        payload = {
            **db_item,
            "id":          row_id,
            "tickers":     item["tickers"],
            "tags":        scored.get("tags", []),
            "published_at": item["published_at"].isoformat(),
            "created_at":  datetime.utcnow().isoformat(),
            "trump_alert":  is_trump,
        }
        await self._broadcast(payload)

    async def _score_with_claude(self, item: dict) -> dict:
        watchlist_str = ", ".join(self._watchlist[:20]) or "SPY, QQQ, NVDA"
        tickers_str   = ", ".join(item["tickers"]) if item["tickers"] else "none"

        prompt = f"""Score this news for an options trader (1-10).

Title: {item['title']}
Summary: {item['raw_summary'][:300]}
Source: {item['source']} ({item['source_type']})
Detected tickers: {tickers_str}
Watchlist: {watchlist_str}

Scoring:
9-10 = Breaking, market-moving (Fed surprise, shock earnings, M&A, geopolitical)
7-8  = Significant company/sector news, clear options impact
5-6  = Relevant financial news, moderate trading implications
1-4  = General business, not actionable for options

Return ONLY valid JSON, no markdown:
{{"score": <int 1-10>, "summary": "<one sentence, max 120 chars>", "tags": ["<tag>"]}}

Valid tags: earnings, macro, fed, sector, mergers, regulation, technical, options, upgrade, downgrade, insider, ipo, guidance, geopolitical, crypto"""

        resp = await self._anthropic.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=160,
            temperature=0,
            messages=[{"role": "user", "content": prompt}],
        )
        text = resp.content[0].text.strip()
        m = re.search(r"\{.*\}", text, re.DOTALL)
        return json.loads(m.group() if m else text)

    @staticmethod
    def _fallback_score(item: dict) -> dict:
        """Simple heuristic when Claude is unavailable."""
        is_sec = item["source_type"] == "sec"
        has_tickers = bool(item["tickers"])
        score = 5 if is_sec else (7 if has_tickers else 5)
        tags = ["regulatory"] if is_sec else []
        return {"score": score, "summary": item["raw_summary"][:120], "tags": tags}

    # ── broadcast ──────────────────────────────────────────────────────────────

    async def _broadcast(self, item: dict) -> None:
        dead = []
        for q in self._queues:
            try:
                q.put_nowait(item)
            except asyncio.QueueFull:
                dead.append(q)
        for q in dead:
            self.unsubscribe(q)


news_manager = NewsFeedManager()
