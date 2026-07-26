export type Severity = "normal" | "medium" | "high" | "critical";

export function percentile(values: number[], percentage: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentage) - 1);
  return sorted[index] ?? 0;
}

export function classifyWindow(jankRate: number, frozenFrames: number): Severity {
  if (frozenFrames > 0) return "critical";
  if (jankRate >= 8) return "high";
  if (jankRate >= 3) return "medium";
  return "normal";
}

export function parseFrameCosts(raw: string) {
  const match = raw.match(/Profile data in ms:\n([\s\S]*?)\n\n/);
  if (!match) return [];

  return match[1]
    .trim()
    .split("\n")
    .map((line) => line.trim().split(/\s+/).slice(0, 4).map(Number))
    .filter((parts) => parts.length === 4 && parts.every(Number.isFinite))
    .map((parts) => parts.reduce((total, value) => total + value, 0))
    .filter((cost) => cost > 0);
}
