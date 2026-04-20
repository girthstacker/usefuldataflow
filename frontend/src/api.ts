import axios from "axios";

const api = axios.create({ baseURL: "/api" });

// Quotes
export const getQuote = (symbol: string) =>
  api.get(`/quotes/${symbol}`).then((r) => r.data);

export const getQuotes = (symbols: string[]) =>
  api.get("/quotes", { params: { symbols: symbols.join(",") } }).then((r) => r.data);

export const getBars = (symbol: string, params?: Record<string, unknown>) =>
  api.get(`/quotes/${symbol}/bars`, { params }).then((r) => r.data);

// Options
export const getChain = (
  symbol: string,
  source = "polygon",
  params?: { expiry_gte?: string; expiry_lte?: string; contract_type?: string; limit?: number }
) =>
  api
    .get(`/options/chain/${symbol}`, { params: { source, ...params } })
    .then((r) => r.data);

export const getFlowStats = (params?: { hours?: number; min_score?: number }) =>
  api.get("/options/flow/stats", { params }).then((r) => r.data);

export const getFlow = (params?: {
  symbol?: string;
  min_score?: number;
  min_premium?: number;
  option_type?: string;
  sweep_only?: boolean;
  limit?: number;
}) => api.get("/options/flow", { params }).then((r) => r.data);

export const watchSymbols = (symbols: string[]) =>
  api.post("/options/stream/watch", { symbols }).then((r) => r.data);

export const getStreamStatus = () =>
  api.get("/options/stream/status").then((r) => r.data);

export const FLOW_STREAM_WS = () =>
  `ws://${location.host}/api/options/flow/stream`;

export const ALERTS_WS = () =>
  `ws://${location.host}/api/alerts/ws`;

// Positions
export const getPositions = () => api.get("/positions").then((r) => r.data);
export const syncSchwab = () => api.post("/positions/sync/schwab").then((r) => r.data);
export const deletePosition = (id: number) =>
  api.delete(`/positions/${id}`).then((r) => r.data);

// Alerts
export const getAlerts = () => api.get("/alerts").then((r) => r.data);
export const createAlert = (body: {
  symbol: string;
  condition: string;
  threshold: number;
  message?: string;
}) => api.post("/alerts", body).then((r) => r.data);
export const updateAlert = (id: number, body: Partial<{ active: boolean; threshold: number; message: string }>) =>
  api.patch(`/alerts/${id}`, body).then((r) => r.data);
export const deleteAlert = (id: number) =>
  api.delete(`/alerts/${id}`).then((r) => r.data);

// News
export const getNews = (params?: { ticker?: string; type?: string; limit?: number }) =>
  api.get("/news", { params }).then((r) => r.data);

export const NEWS_STREAM_WS = () =>
  `ws://${location.host}/api/news/stream`;

// Auth
export const getAuthStatus = () => api.get("/auth/status").then((r) => r.data);

export default api;
