"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

function parseInlineBold(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text)) !== null) {
    const token = match[0];
    const idx = match.index;
    if (idx > last) out.push(<span key={`t-${key++}`}>{text.slice(last, idx)}</span>);

    const boldText = token.startsWith("**")
      ? token.slice(2, -2)
      : token.startsWith("*")
        ? token.slice(1, -1)
        : token;
    out.push(
      <strong key={`b-${key++}`} className="font-semibold text-white">
        {boldText}
      </strong>,
    );
    last = idx + token.length;
  }

  if (last < text.length) out.push(<span key={`t-${key++}`}>{text.slice(last)}</span>);
  return out;
}

// Section headings output by AI responses
const HEADING_PATTERN =
  /^(Verdict|Reasoning|Evidence|What matters now|Holdings most impacted|How your current holdings may be impacted|Actionable watch items.*|Key Risks|Key Opportunities|Summary)$/i;

export function LLMText({
  text,
  className,
  lineClassName,
}: {
  text: string | null | undefined;
  className?: string;
  lineClassName?: string;
}) {
  const safeText = typeof text === "string" ? text : "";
  const lines = safeText.replace(/\r\n/g, "\n").split("\n");

  return (
    <div className={cn("llm-copy space-y-1", className)}>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={`sp-${i}`} className="h-2" />;

        // Section heading — style distinctly
        if (HEADING_PATTERN.test(trimmed)) {
          return (
            <p key={`hd-${i}`} className="pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent">
              {trimmed}
            </p>
          );
        }

        const isList = /^\s*([-*]|\d+\.)\s+/.test(line);
        const content = line.replace(/^\s*([-*]|\d+\.)\s+/, "");
        return (
          <p key={`ln-${i}`} className={cn("text-sm leading-6 text-gray-200", lineClassName)}>
            {isList ? <span className="mr-2 text-muted">{"\u2022"}</span> : null}
            {parseInlineBold(content)}
          </p>
        );
      })}
    </div>
  );
}
