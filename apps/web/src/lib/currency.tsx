"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export type Currency = "CAD" | "USD";
const STORAGE_KEY = "lnz_currency";

function normalizeCurrency(value: string | null | undefined): Currency {
  return value === "USD" ? "USD" : "CAD";
}

interface CurrencyContextValue {
  currency: Currency;
  setCurrency: (c: Currency) => void;
  /** USD per 1 CAD, e.g. 0.7234. null while loading. */
  usdPerCad: number | null;
  /** Convert a CAD amount to the active display currency. */
  fromCad: (amount: number | null | undefined) => number | null;
  /** Convert a USD amount to the active display currency. */
  fromUsd: (amount: number | null | undefined) => number | null;
  /** Format a value that is already in the display currency. */
  fmtC: (amount: number | null | undefined, decimals?: number) => string;
  /** "CAD" or "USD" */
  currencyLabel: Currency;
  /** true while the initial rate fetch is in flight */
  rateLoading: boolean;
}

const CurrencyContext = createContext<CurrencyContextValue>({
  currency: "CAD",
  setCurrency: () => undefined,
  usdPerCad: null,
  fromCad: (v) => (v == null ? null : v),
  fromUsd: (v) => (v == null ? null : v),
  fmtC: (v) => (v == null ? "—" : `$${v.toFixed(0)}`),
  currencyLabel: "CAD",
  rateLoading: true,
});

function formatCurrency(
  amount: number | null | undefined,
  currency: Currency,
  decimals = 0,
): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>("CAD");

  const [usdPerCad, setUsdPerCad] = useState<number | null>(null);
  const [rateLoading, setRateLoading] = useState(true);

  const fetchRate = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/fx");
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data.usd_per_cad === "number") {
        setUsdPerCad(data.usd_per_cad);
      }
    } catch {
      // keep previous rate on network error
    } finally {
      setRateLoading(false);
    }
  }, []);

  // Fetch on mount, then every 5 minutes
  useEffect(() => {
    fetchRate();
    const id = setInterval(fetchRate, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [fetchRate]);

  // Restore persisted currency preference on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setCurrencyState(normalizeCurrency(localStorage.getItem(STORAGE_KEY)));
  }, []);

  // Keep persistence synchronized with active state.
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(STORAGE_KEY, currency);
  }, [currency]);

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c);
  }, []);

  /** Portfolio data (weekly series) lives in CAD — convert to USD if needed. */
  const fromCad = useCallback(
    (amount: number | null | undefined): number | null => {
      if (amount == null) return null;
      if (currency === "CAD") return amount;
      if (!usdPerCad) return null;
      return amount * usdPerCad;
    },
    [currency, usdPerCad],
  );

  /** Yahoo Finance holdings prices are in USD — convert to CAD if needed. */
  const fromUsd = useCallback(
    (amount: number | null | undefined): number | null => {
      if (amount == null) return null;
      if (currency === "USD") return amount;
      if (!usdPerCad) return null;
      return amount / usdPerCad;
    },
    [currency, usdPerCad],
  );

  const fmtC = useCallback(
    (amount: number | null | undefined, decimals = 0): string =>
      formatCurrency(amount, currency, decimals),
    [currency],
  );

  return (
    <CurrencyContext.Provider
      value={{
        currency,
        setCurrency,
        usdPerCad,
        fromCad,
        fromUsd,
        fmtC,
        currencyLabel: currency,
        rateLoading,
      }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  return useContext(CurrencyContext);
}
