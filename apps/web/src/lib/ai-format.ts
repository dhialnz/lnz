import type { PortfolioInsights } from "@/lib/types";

type InsightLineKind = "risk" | "opportunity" | "generic";

function extractLeadingObject(text: string): { objectPart: string | null; trailing: string } {
  const raw = text.trimStart();
  const openIndex = raw.indexOf("{");
  if (openIndex < 0) return { objectPart: null, trailing: raw };

  const prefix = raw.slice(0, openIndex);
  // Accept prefixes like ":" / bullets / spaces. Reject normal prose prefixes.
  if (/[A-Za-z0-9]/.test(prefix)) return { objectPart: null, trailing: raw };

  const objRaw = raw.slice(openIndex);

  let depth = 0;
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let i = 0; i < objRaw.length; i += 1) {
    const ch = objRaw[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          objectPart: objRaw.slice(0, i + 1),
          trailing: objRaw.slice(i + 1),
        };
      }
    }
  }
  return { objectPart: null, trailing: raw };
}

function pullField(text: string, key: string): string | null {
  const pattern = new RegExp(`['"]${key}['"]\\s*:\\s*['"]([^'"]+)['"]`, "i");
  const match = text.match(pattern);
  if (!match) return null;
  const value = String(match[1] ?? "").trim();
  return value || null;
}

function normalizeStructuredLine(raw: string, kind: InsightLineKind): string {
  const text = raw.trim().replace(/^[\s\-\*\u2022]+/, "");
  if (!text) return "";

  const { objectPart, trailing } = extractLeadingObject(text);
  const objectText = objectPart ?? (text.startsWith("{") && text.endsWith("}") ? text : null);
  if (!objectText) return text;

  const primaryKeys =
    kind === "risk"
      ? ["risk", "issue", "threat", "title", "headline"]
      : kind === "opportunity"
        ? ["opportunity", "idea", "tailwind", "title", "headline"]
        : ["summary", "message", "title", "headline", "risk", "opportunity"];
  const secondaryKeys = ["impact", "reason", "rationale", "detail", "thesis"];

  const primary = primaryKeys.map((k) => pullField(objectText, k)).find(Boolean) ?? null;
  const secondary = secondaryKeys.map((k) => pullField(objectText, k)).find(Boolean) ?? null;
  const tail = trailing.trim().replace(/^[\-:;,\.\s]+/, "");

  let out = primary ?? secondary ?? "";
  if (primary && secondary && secondary.toLowerCase() !== primary.toLowerCase()) {
    out = `${primary}: ${secondary}`;
  }
  if (tail) {
    out = out ? `${out} ${tail}` : tail;
  }
  return out.trim();
}

export function sanitizeInsightLines(lines: string[] | null | undefined, kind: InsightLineKind): string[] {
  if (!Array.isArray(lines)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const segments = String(line ?? "")
      .split(/\r?\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const segment of segments) {
      if (/^key\s+(risks?|opportunities?)\b/i.test(segment)) continue;
      const cleaned = normalizeStructuredLine(segment, kind).replace(/\s+/g, " ").trim();
      if (!cleaned) continue;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cleaned);
    }
  }
  return out;
}

export function sanitizeSummaryText(summary: string | null | undefined): string {
  let text = String(summary ?? "").trim();
  if (!text) return "";

  // If the model bundled sections into summary, trim to summary-only text.
  const lower = text.toLowerCase();
  const keyRiskPos = lower.indexOf("key risks");
  const keyOppPos = lower.indexOf("key opportunities");
  const cutAt = [keyRiskPos, keyOppPos]
    .filter((x) => x >= 0)
    .sort((a, b) => a - b)[0];
  if (typeof cutAt === "number" && cutAt >= 0) {
    text = text.slice(0, cutAt).trim();
  }

  const { objectPart, trailing } = extractLeadingObject(text);
  if (objectPart && trailing.trim()) {
    text = trailing.trim();
  }
  return normalizeStructuredLine(text, "generic").replace(/\s+/g, " ").trim();
}

export function sanitizePortfolioInsights(
  insights: (PortfolioInsights & { model_used?: string }) | null | undefined,
): (PortfolioInsights & { model_used?: string }) | null {
  if (!insights) return null;
  return {
    ...insights,
    summary: sanitizeSummaryText(insights.summary),
    key_risks: sanitizeInsightLines(insights.key_risks, "risk"),
    key_opportunities: sanitizeInsightLines(insights.key_opportunities, "opportunity"),
  };
}
