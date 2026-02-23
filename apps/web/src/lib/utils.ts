import { clsx, type ClassValue } from "clsx";
import type { Regime, RiskLevel } from "./types";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function fmt(value: number | null | undefined, decimals = 2): string {
  if (value == null) return "—";
  return value.toFixed(decimals);
}

export function fmtPct(value: number | null | undefined, decimals = 2): string {
  if (value == null) return "—";
  return `${(value * 100).toFixed(decimals)}%`;
}

export function fmtCurrency(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function regimeColor(regime: Regime): string {
  switch (regime) {
    case "Defensive":
      return "text-negative";
    case "Recovery":
      return "text-caution";
    case "Expansion":
      return "text-positive";
    default:
      return "text-muted";
  }
}

export function regimeBgColor(regime: Regime): string {
  switch (regime) {
    case "Defensive":
      return "bg-red-950 border-negative";
    case "Recovery":
      return "bg-yellow-950 border-caution";
    case "Expansion":
      return "bg-green-950 border-positive";
    default:
      return "bg-panel border-border";
  }
}

export function riskColor(risk: RiskLevel): string {
  switch (risk) {
    case "High":
      return "text-negative";
    case "Medium":
      return "text-caution";
    case "Low":
      return "text-positive";
  }
}

export function sentimentColor(score: number | null): string {
  if (score == null) return "text-muted";
  if (score >= 0.2) return "text-positive";
  if (score <= -0.2) return "text-negative";
  return "text-caution";
}

export function isPositive(value: number | null | undefined): boolean {
  return value != null && value > 0;
}

export function signedClass(value: number | null | undefined): string {
  if (value == null) return "text-muted";
  return value >= 0 ? "text-positive" : "text-negative";
}
