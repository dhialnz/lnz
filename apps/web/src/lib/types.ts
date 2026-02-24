// â”€â”€â”€ Portfolio â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface PortfolioSeriesRow {
  id: string;
  date: string;
  total_value: number;
  net_deposits: number;
  period_deposits: number;
  spy_close: number | null;
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

export interface ClearImportedDataResult {
  deleted_series_rows: number;
  deleted_import_rows: number;
  deleted_recommendation_rows: number;
  deleted_files: number;
  message: string;
}

export interface ManualWeekEntryInput {
  total_value: number;
  net_deposits: number;
}

export interface ManualWeekEntryResult {
  date: string;
  spy_close: number;
  period_deposits: number;
  period_return: number;
  benchmark_return: number;
  row_count: number;
  regime: Regime;
  regime_explanation: string;
  message: string;
}

export interface SpyHistorySyncResult {
  updated_rows: number;
  message: string;
}

// â”€â”€â”€ Recommendations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Market â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  raw_payload?: Record<string, unknown>;
}

export interface HoldingImpact {
  ticker: string;
  name: string | null;
  weight: number | null;
  impact_score: number;
  direction: "positive" | "negative" | "mixed";
  reason: string;
}

export interface NewsEventImpact {
  event: NewsEvent;
  rank_score: number;
  portfolio_impact_score: number;
  net_sentiment_impact: number | null;
  impacted_holdings: HoldingImpact[];
}

export interface NewsPortfolioImpact {
  generated_at: string;
  events: NewsEventImpact[];
  top_impacted_holdings: HoldingImpact[];
}

// â”€â”€â”€ Holdings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface SparklinePoint {
  date: string;
  close: number;
}

export interface HoldingLive {
  id: string;
  ticker: string;
  name: string | null;
  shares: number;
  avg_cost_per_share: number;
  avg_cost_currency: "CAD" | "USD";
  avg_cost_per_share_usd: number | null;
  notes: string | null;
  added_at: string;

  current_price: number | null;
  day_change: number | null;
  day_change_pct: number | null;

  total_cost_basis: number;
  total_value: number | null;
  unrealized_pnl: number | null;
  unrealized_pnl_pct: number | null;
  weight: number | null;

  sparkline: SparklinePoint[];
}

export interface HoldingsSnapshot {
  holdings: HoldingLive[];
  total_cost_basis: number;
  total_value: number | null;
  total_unrealized_pnl: number | null;
  total_unrealized_pnl_pct: number | null;
  total_day_change: number | null;
  total_day_change_pct: number | null;
  sharpe_30d: number | null;
  sortino_30d: number | null;
  as_of: string;
}

export interface HoldingIn {
  ticker: string;
  shares: number;
  avg_cost_per_share: number;
  avg_cost_currency: "CAD" | "USD";
  notes?: string;
}

// â”€â”€â”€ Rulebook â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface RulebookThresholds {
  drawdown_defensive?: number;
  drawdown_hard_stop?: number;
  vol8_high?: number;
  concentration_trim?: number;
  deploy_tranche_1?: number;
  deploy_tranche_2?: number;
  deploy_tranche_3?: number;
  expansion_drawdown?: number;
  near_peak_pct?: number;
  profit_taking_mtd?: number;
  [key: string]: number | undefined;
}

export interface Rulebook {
  id: string;
  thresholds: RulebookThresholds;
  text: string;
  updated_at: string;
}

export interface RiskQuizInput {
  age: number;
  investment_horizon_years: number;
  liquidity_needs: "low" | "medium" | "high";
  drawdown_tolerance: "low" | "medium" | "high";
  investing_experience: "beginner" | "intermediate" | "advanced";
}

export interface RiskQuizRecommendation {
  profile: "Conservative" | "Balanced" | "Growth";
  score: number;
  thresholds: RulebookThresholds;
  rationale: string[];
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ AI Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

export interface AISuggestion {
  action: "buy" | "hold" | "sell";
  ticker: string;
  confidence: number;
  rationale: string;
  size_hint: string | null;
}

export interface PortfolioInsights {
  generated_at: string;
  used_ai: boolean;
  model: string;
  summary: string;
  key_risks: string[];
  key_opportunities: string[];
  suggestions: AISuggestion[];
  watchlist: string[];
  sources: string[];
}

export interface AIStatus {
  ai_enabled: boolean;
  provider: "gemini" | "openai" | "deterministic" | string;
  model: string;
}

export interface AIChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AIChatResponse {
  reply: string;
  used_ai: boolean;
  model: string;
  sources: string[];
}

export interface AIDashboardRecommendations {
  generated_at: string;
  used_ai: boolean;
  model: string;
  recommendations: Recommendation[];
}

export interface AINewsSummary {
  generated_at: string;
  used_ai: boolean;
  model: string;
  summary: string;
}

