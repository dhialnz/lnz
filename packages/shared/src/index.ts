/**
 * Shared types and constants between apps/web and any future frontends.
 * These mirror the Pydantic schemas defined in apps/api.
 *
 * For the MVP, apps/web imports from its own src/lib/types.ts.
 * This package is the canonical source for future cross-app sharing.
 */

export type Regime = "Defensive" | "Recovery" | "Expansion" | "Neutral";
export type RiskLevel = "Low" | "Medium" | "High";
export type Category =
  | "Deployment"
  | "Profit Taking"
  | "Risk Control"
  | "Monthly Mode"
  | "News/Macro";

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
}

export interface PortfolioSummary {
  date: string;
  total_value: number;
  alpha_latest: number;
  cumulative_alpha: number;
  rolling_4w_alpha: number | null;
  rolling_8w_vol: number | null;
  running_peak: number;
  drawdown: number;
  max_drawdown: number;
  beta_12w: number | null;
  volatility_ratio: number | null;
  row_count: number;
  regime: Regime;
  regime_explanation: string;
}

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

// ── Validation constants (mirrors Python defaults) ────────────────────────────

export const DEFAULT_THRESHOLDS: RulebookThresholds = {
  drawdown_defensive: -0.08,
  drawdown_hard_stop: -0.10,
  vol8_high: 0.04,
  concentration_trim: 0.15,
  deploy_tranche_1: 0.30,
  deploy_tranche_2: 0.30,
  deploy_tranche_3: 0.40,
  expansion_drawdown: -0.03,
  near_peak_pct: 0.02,
  profit_taking_mtd: 0.06,
};

export const REQUIRED_EXCEL_COLUMNS = [
  "Date",
  "Total Value",
  "Period Return",
  "SPY Period Return",
] as const;

export const OPTIONAL_EXCEL_COLUMNS = [
  "Net Deposits",
  "Period Deposits",
] as const;
