"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: keyof T | string;
  label: string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
}

interface DataTableProps<T extends Record<string, unknown>> {
  columns: Column<T>[];
  data: T[];
  rowKey: keyof T;
  emptyMessage?: string;
}

type SortDir = "asc" | "desc";

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  rowKey,
  emptyMessage = "No data",
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filter, setFilter] = useState("");

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const filtered = data.filter((row) =>
    Object.values(row).some((v) =>
      String(v).toLowerCase().includes(filter.toLowerCase()),
    ),
  );

  const sorted = sortKey
    ? [...filtered].sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sortDir === "asc" ? cmp : -cmp;
      })
    : filtered;

  return (
    <div className="flex flex-col gap-3">
      <input
        type="text"
        placeholder="Filter…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="w-56 bg-surface border border-border rounded px-3 py-1.5 text-xs font-mono text-gray-200 placeholder-muted focus:outline-none focus:border-accent"
      />

      <div className="rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface">
              <tr>
                {columns.map((col) => (
                  <th
                    key={String(col.key)}
                    onClick={() => col.sortable && handleSort(String(col.key))}
                    className={cn(
                      "px-3 py-2.5 text-left font-mono text-muted uppercase tracking-wider border-b border-border",
                      col.sortable && "cursor-pointer hover:text-gray-200 select-none",
                      col.className,
                    )}
                  >
                    {col.label}
                    {col.sortable && sortKey === String(col.key) && (
                      <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-3 py-8 text-center text-muted font-mono"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                sorted.map((row) => (
                  <tr
                    key={String(row[rowKey])}
                    className="border-b border-border last:border-0 hover:bg-white/[0.02] transition-colors"
                  >
                    {columns.map((col) => (
                      <td key={String(col.key)} className={cn("px-3 py-2 font-mono", col.className)}>
                        {col.render
                          ? col.render(row)
                          : String(row[col.key as keyof T] ?? "—")}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs font-mono text-muted">
        {sorted.length} of {data.length} rows
      </p>
    </div>
  );
}
