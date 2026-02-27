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
    <div className="hf-card p-5 flex flex-col gap-2">
      <span className="text-[11px] font-sans text-muted uppercase tracking-[0.08em]">{label}</span>
      <span className={cn("text-[32px] leading-none hf-display", valueClass ?? "text-gray-100")}>
        {value}
      </span>
      {subValue && (
        <span className="text-xs font-sans text-muted">{subValue}</span>
      )}
      {description && (
        <span className="text-xs text-muted">{description}</span>
      )}
    </div>
  );
}
