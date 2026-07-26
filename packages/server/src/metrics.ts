export type Severity = "normal" | "medium" | "high" | "critical";

// 使用排序副本计算分位数，避免改变调用方保留的原始帧序列。
export function percentile(values: number[], percentage: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentage) - 1);
  return sorted[index] ?? 0;
}

// 冻结帧优先于卡顿率判定，确保严重渲染阻塞不会被平均指标掩盖。
export function classifyWindow(jankRate: number, frozenFrames: number): Severity {
  if (frozenFrames > 0) return "critical";
  if (jankRate >= 8) return "high";
  if (jankRate >= 3) return "medium";
  return "normal";
}

// 保留旧版调用入口，统一委托给同时兼容两种 gfxinfo 格式的解析器。
export function parseFrameCosts(raw: string) {
  return parseFrameStats(raw).frameCosts;
}

// 兼容旧版 Profile data 和新版 framestats，向采集器返回可诊断的格式与行数信息。
export function parseFrameStats(raw: string) {
  const match = raw.match(/Profile data in ms:\n([\s\S]*?)\n\n/);
  if (match) {
    const frameCosts = match[1]
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/).slice(0, 4).map(Number))
      .filter((parts) => parts.length === 4 && parts.every(Number.isFinite))
      .map((parts) => parts.reduce((total, value) => total + value, 0))
      .filter((cost) => cost > 0);

    return { format: "profile" as const, frameCosts, sourceRows: frameCosts.length };
  }

  const marker = raw.indexOf("---PROFILEDATA---");
  if (marker < 0) return { format: "unknown" as const, frameCosts: [], sourceRows: 0 };

  const lines = raw.slice(marker + "---PROFILEDATA---".length).split("\n").map((line) => line.trim()).filter(Boolean);
  const header = lines.shift()?.split(",").map((column) => column.trim()) ?? [];
  const intendedVsyncIndex = header.indexOf("IntendedVsync");
  const frameCompletedIndex = header.indexOf("FrameCompleted");
  if (intendedVsyncIndex < 0 || frameCompletedIndex < 0) {
    return { format: "framestats" as const, frameCosts: [], sourceRows: 0 };
  }

  // framestats 时间戳以纳秒表示，帧耗时由计划 Vsync 到完成渲染的差值计算。
  const frameCosts = lines
    .map((line) => line.split(",").map(Number))
    .filter((columns) => Number.isFinite(columns[intendedVsyncIndex]) && Number.isFinite(columns[frameCompletedIndex]))
    .map((columns) => (columns[frameCompletedIndex]! - columns[intendedVsyncIndex]!) / 1_000_000)
    .filter((cost) => cost > 0 && cost < 60_000);

  return { format: "framestats" as const, frameCosts, sourceRows: lines.length };
}

// 仅接受已授权的 device 状态，忽略 offline 和 unauthorized 设备。
export function parseConnectedDevices(raw: string) {
  return raw.split("\n").slice(1).flatMap((line) => {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2 || parts[1] !== "device") return [];
    const model = parts.find((part) => part.startsWith("model:"))?.slice(6).replaceAll("_", " ") ?? "Android device";
    return [{ id: parts[0]!, model }];
  });
}

// 过滤 pm list packages 输出中的非包名内容，再按名称排序以稳定前端选择列表。
export function parseThirdPartyPackages(raw: string) {
  return raw.split("\n")
    .map((line) => line.trim().replace(/^package:/, ""))
    .filter((packageName) => /^[A-Za-z0-9._:-]+$/.test(packageName))
    .sort((left, right) => left.localeCompare(right));
}
