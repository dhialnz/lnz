"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * React error boundary — catches render-time exceptions and shows a safe
 * fallback instead of crashing the entire page.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Log to console so it surfaces in browser dev tools / server logs.
    console.error("[LNZ ErrorBoundary]", error.message, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 rounded-xl border border-red-500/30 bg-red-900/10 p-6 text-center">
            <p className="text-sm font-semibold text-red-400">Something went wrong</p>
            <p className="max-w-sm text-xs text-muted">
              {this.state.error.message || "An unexpected error occurred. Refresh the page to try again."}
            </p>
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-lg border border-red-500/40 px-4 py-1.5 text-xs text-red-400 hover:bg-red-900/20 transition"
            >
              Try again
            </button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
