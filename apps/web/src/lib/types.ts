// ─── Portfolio ─────────────────────────────────────────────────────────────────

export interface PortfolioSeriesRow {
  id: string;
  date: string;
  total_value: number;
  net_deposits: number;
  period_deposits: number;
  period_return: number;
  benchmark_return: number;
  alpha: number | null;
  cumulative_alpha: number | null;
  rolling_4w_alpha: number | null;
  rolling_8w_vol: number | null;
  rolling_8w_alpha_vol: number | null;
  running_peak: number | null;
  drawdown: number | null;
  beta_12w: number | null;
  created_at: string;
}

export type Regime = "Defensive" | "Recovery" | "Expansion" | "Neutral";

export interface PortfolioSummary {
  date: string;
  total_value: number;
  alpha_latest: number;
  cumulative_alpha: number;
  rolling_4w_alpha: number | null;
  rolling_8w_vol: number | null;
  rolling_8w_alpha_vol: number | null;
  running_peak: number;
  drawdown: number;
  max_drawdown: number;
  beta_12w: number | null;
  volatility_ratio: number | null;
  row_count: number;
  regime: Regime;
  regime_explanation: string;
}

export interface ImportResult {
  import_id: string;
  filename: string;
  row_count: number;
  regime: Regime;
  regime_explanation: string;
  message: string;
}

export interface ParsePreview {
  columns: string[];
  rows: Record<string, string>[];
  row_count: number;
  errors: string[];
}

// ─── Recommendations ───────────────────────────────────────────────────────────

export type RiskLevel = "Low" | "Medium" | "High";
export type Category =
  | "Deployment"
  | "Profit Taking"
  | "Risk Control"
  | "Monthly Mode"
  | "News/Macro";

export interface Recommendation {
  id: string;
  created_at: string;
  title: string;
  risk_level: RiskLevel;
  category: Category;
  triggers: string[];
  explanation: string;
  supporting_metrics: Record<string, unknown>;
  actions: string[];
  confidence: number;
}

// ─── Market ────────────────────────────────────────────────────────────────────

export interface MarketSnapshot {
  id: string;
  captured_at: string;
  payload: {
    spy?: number;
    vix?: number;
    t2y?: number;
    t10y?: number;
    dxy?: number;
    btc?: number;
    sectors?: Record<string, number>;
    fetched_at?: string;
    _provider?: string;
  };
}

export interface NewsEvent {
  id: string;
  captured_at: string;
  headline: string;
  source: string;
  url: string | null;
  entities: string[];
  event_type: string;
  sentiment_score: number | null;
  volatility_score: number | null;
  confidence: number | null;
}

// ─── Rulebook ──────────────────────────────────────────────────────────────────

export interface RulebookThresholds {
  drawdown_defensive: number;
  drawdown_hard_stop: number;
  vol8_high: number;
  concentration_trim: number;
  deploy_tranche_1: number;
  deploy_tranche_2: number;
  deploy_tranche_3: number;
  expansion_drawdown: number;
  near_peak_pct: number;
  profit_taking_mtd: number;
  [key: string]: number;
}

export interface Rulebook {
  id: string;
  thresholds: RulebookThresholds;
  text: string;
  updated_at: string;
}
