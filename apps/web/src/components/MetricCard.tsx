import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string;
  subValue?: string;
  valueClass?: string;
  description?: string;
}

export function MetricCard({
  label,
  value,
  subValue,
  valueClass,
  description,
}: MetricCardProps) {
  return (
    <div className="bg-panel border border-border rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs font-mono text-muted uppercase tracking-wider">{label}</span>
      <span className={cn("text-2xl font-mono font-semibold", valueClass ?? "text-gray-100")}>
        {value}
      </span>
      {subValue && (
        <span className="text-xs font-mono text-muted">{subValue}</span>
      )}
      {description && (
        <span className="text-xs text-muted mt-1">{description}</span>
      )}
    </div>
  );
}
