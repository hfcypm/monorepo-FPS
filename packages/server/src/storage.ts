export type PerformanceRecord = {
  sessionId: string;
  deviceId: string;
  packageName: string;
  timestamp: string;
  refreshRate: number;
  frameBudgetMs: number;
  fps: number;
  totalFrames: number;
  jankFrames: number;
  frozenFrames: number;
  averageFrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  jankRate: number;
  severity: string;
};

function configuration() {
  const url = process.env.PERFORMANCE_CLICKHOUSE_URL?.replace(/\/$/, "");
  return url ? {
    url,
    database: process.env.PERFORMANCE_CLICKHOUSE_DATABASE ?? "performance",
    user: process.env.PERFORMANCE_CLICKHOUSE_USER ?? "default",
    key: process.env.PERFORMANCE_CLICKHOUSE_KEY ?? "",
  } : null;
}

export function isClickHouseConfigured() {
  return configuration() !== null;
}

export async function persistPerformanceWindow(record: PerformanceRecord) {
  const config = configuration();
  if (!config) return;

  const query = `INSERT INTO ${config.database}.performance_windows FORMAT JSONEachRow`;
  const response = await fetch(`${config.url}/?query=${encodeURIComponent(query)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-ClickHouse-User": config.user,
      "X-ClickHouse-Key": config.key,
    },
    body: JSON.stringify(record),
  });

  if (!response.ok) throw new Error(`ClickHouse 写入失败：${response.status}`);
}
