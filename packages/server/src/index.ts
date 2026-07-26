import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { $ } from "bun";
import { existsSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";
import { classifyWindow, parseConnectedDevices, parseFrameStats, parseThirdPartyPackages, percentile, type Severity } from "./metrics";
import { isClickHouseConfigured, persistPerformanceWindow } from "./storage";

type PerformanceWindow = {
  timestamp: string;
  fps: number;
  refreshRate: number;
  frameBudgetMs: number;
  totalFrames: number;
  jankFrames: number;
  frozenFrames: number;
  averageFrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  jankRate: number;
  severity: Severity;
};

type PerformanceIncident = {
  id: string;
  timestamp: string;
  severity: Exclude<Severity, "normal">;
  reason: string;
  frameMs: number;
  stack?: string;
};

type PerformanceSession = {
  id: string;
  deviceId: string;
  packageName: string;
  startedAt: string;
  updatedAt: string;
  refreshRate: number;
  status: "collecting" | "waiting" | "error";
  error?: string;
  totals: {
    frames: number;
    jankFrames: number;
    frozenFrames: number;
  };
  windows: PerformanceWindow[];
  incidents: PerformanceIncident[];
};

type AdbDevice = {
  id: string;
  model: string;
};

type CollectionTarget = {
  deviceId: string;
  packageName: string;
};

type DiagnosticEntry = {
  id: string;
  timestamp: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  detail?: string;
};

const app = new Elysia().use(staticPlugin({ assets: "dist", prefix: "/" }));

for (const directory of ["./logs", "./traces", "./dist"]) {
  if (!existsSync(directory)) mkdirSync(directory);
}

const SAMPLE_INTERVAL_MS = 1000;
const MAX_WINDOWS = 150;
const MAX_INCIDENTS = 30;
const MAX_DIAGNOSTICS = 80;
const STACK_CAPTURE_COOLDOWN_MS = 10_000;
const adbPath = process.env.ADB_PATH ?? "adb";

let activeSession: PerformanceSession | null = null;
const sessions = new Map<string, PerformanceSession>();
let collecting = false;
let lastStackCaptureAt = 0;
let refreshRateCache = { deviceId: "", value: 60, updatedAt: 0 };
let collectionTarget: CollectionTarget | null = null;
const diagnostics: DiagnosticEntry[] = [];

function recordDiagnostic(entry: Omit<DiagnosticEntry, "id" | "timestamp">) {
  const latest = diagnostics[0];
  if (latest?.level === entry.level && latest.message === entry.message && latest.detail === entry.detail) return;

  const diagnostic = { id: randomUUID(), timestamp: new Date().toISOString(), ...entry };
  diagnostics.unshift(diagnostic);
  if (diagnostics.length > MAX_DIAGNOSTICS) diagnostics.pop();
  app.server?.publish("diagnostic-event", JSON.stringify({ event: "diagnostic", entry: diagnostic }));
}

function validAdbIdentifier(value: unknown) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]+$/.test(value);
}

async function listDevices(): Promise<AdbDevice[]> {
  const text = await $`${adbPath} devices -l`.text();
  return parseConnectedDevices(text);
}

async function listPackages(deviceId: string) {
  const text = await $`${adbPath} -s ${deviceId} shell pm list packages -3`.text();
  return parseThirdPartyPackages(text);
}

async function getRefreshRate(deviceId: string) {
  const now = Date.now();
  if (refreshRateCache.deviceId === deviceId && now - refreshRateCache.updatedAt < 30_000) return refreshRateCache.value;

  try {
    const text = await $`${adbPath} -s ${deviceId} shell settings get system peak_refresh_rate`.text();
    const refreshRate = Number.parseFloat(text);
    if (Number.isFinite(refreshRate) && refreshRate >= 30 && refreshRate <= 240) {
      refreshRateCache = { deviceId, value: refreshRate, updatedAt: now };
    }
  } catch {
    refreshRateCache.updatedAt = now;
  }

  return refreshRateCache.value;
}

async function ensureSession(target: CollectionTarget, refreshRate: number) {
  if (activeSession?.packageName === target.packageName && activeSession.deviceId === target.deviceId) {
    activeSession.refreshRate = refreshRate;
    return activeSession;
  }

  activeSession = {
    id: randomUUID(),
    deviceId: target.deviceId,
    packageName: target.packageName,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    refreshRate,
    status: "collecting",
    totals: { frames: 0, jankFrames: 0, frozenFrames: 0 },
    windows: [],
    incidents: [],
  };
  sessions.set(activeSession.id, activeSession);

  await $`${adbPath} -s ${target.deviceId} shell dumpsys gfxinfo ${target.packageName} reset`.quiet();
  return activeSession;
}

async function captureMainStack(session: PerformanceSession, incident: PerformanceIncident) {
  if (Date.now() - lastStackCaptureAt < STACK_CAPTURE_COOLDOWN_MS) return;
  lastStackCaptureAt = Date.now();

  try {
    const pid = (await $`${adbPath} -s ${session.deviceId} shell pidof ${session.packageName}`.text()).trim();
    if (!pid) throw new Error("未获取到应用进程");

    const stack = await $`${adbPath} -s ${session.deviceId} shell dumpsys thread ${pid} main`.text();
    incident.stack = stack.substring(0, 7000);
    app.server?.publish("stack-event", JSON.stringify({ event: "stack", sessionId: session.id, incident }));
  } catch (error) {
    incident.stack = `主线程堆栈采集失败：${error instanceof Error ? error.message : "未知错误"}`;
    recordDiagnostic({ level: "warning", message: "主线程堆栈采集失败", detail: incident.stack });
  }
}

function persistWindow(session: PerformanceSession, window: PerformanceWindow) {
  void persistPerformanceWindow({
    sessionId: session.id,
    deviceId: session.deviceId,
    packageName: session.packageName,
    ...window,
  }).catch((error) => console.error(error));
}

async function collectPerformance() {
  if (collecting) return;
  collecting = true;

  try {
    if (!collectionTarget) {
      if (activeSession) activeSession.status = "waiting";
      recordDiagnostic({ level: "warning", message: "等待采集目标", detail: "请选择设备和第三方应用后发起连接" });
      return;
    }

    const devices = await listDevices();
    if (!devices.some((device) => device.id === collectionTarget?.deviceId)) {
      throw new Error("所选设备当前未处于 ADB 已连接状态");
    }

    const refreshRate = await getRefreshRate(collectionTarget.deviceId);
    const session = await ensureSession(collectionTarget, refreshRate);
    const raw = await $`${adbPath} -s ${collectionTarget.deviceId} shell dumpsys gfxinfo ${collectionTarget.packageName} framestats`.text();
    const frameStats = parseFrameStats(raw);
    const frameCosts = frameStats.frameCosts;
    await $`${adbPath} -s ${collectionTarget.deviceId} shell dumpsys gfxinfo ${collectionTarget.packageName} reset`.quiet();

    recordDiagnostic({ level: "info", message: "帧数据解析完成", detail: `${frameStats.format} · 原始输出 ${raw.length} 字符 · 数据行 ${frameStats.sourceRows} · 有效帧 ${frameCosts.length}` });

    if (frameCosts.length === 0) {
      recordDiagnostic({ level: "warning", message: "未读取到帧数据", detail: `${collectionTarget.deviceId} · ${collectionTarget.packageName} · 格式 ${frameStats.format}，请打开应用并进行界面操作` });
      return;
    }

    const frameBudgetMs = 1000 / refreshRate;
    const totalFrames = frameCosts.length;
    const jankFrames = frameCosts.filter((cost) => cost > frameBudgetMs).length;
    const frozenFrames = frameCosts.filter((cost) => cost > 700).length;
    const averageFrameMs = frameCosts.reduce((total, cost) => total + cost, 0) / totalFrames;
    const jankRate = (jankFrames / totalFrames) * 100;
    const severity = classifyWindow(jankRate, frozenFrames);
    const timestamp = new Date().toISOString();
    const window: PerformanceWindow = {
      timestamp,
      fps: Math.min(refreshRate, Math.round(1000 / averageFrameMs)),
      refreshRate,
      frameBudgetMs,
      totalFrames,
      jankFrames,
      frozenFrames,
      averageFrameMs,
      p95FrameMs: percentile(frameCosts, 0.95),
      p99FrameMs: percentile(frameCosts, 0.99),
      jankRate,
      severity,
    };

    session.status = "collecting";
    session.error = undefined;
    session.updatedAt = timestamp;
    session.totals.frames += totalFrames;
    session.totals.jankFrames += jankFrames;
    session.totals.frozenFrames += frozenFrames;
    session.windows.push(window);
    if (session.windows.length > MAX_WINDOWS) session.windows.shift();
    persistWindow(session, window);
    recordDiagnostic({ level: "success", message: "采集窗口已刷新", detail: `${session.deviceId} · ${session.packageName} · ${totalFrames} 帧 · ${window.fps} FPS` });

    if (severity !== "normal") {
      const incident: PerformanceIncident = {
        id: randomUUID(),
        timestamp,
        severity,
        reason: frozenFrames > 0 ? "检测到冻结帧" : `卡顿率 ${jankRate.toFixed(1)}%`,
        frameMs: Math.max(...frameCosts),
      };
      session.incidents.unshift(incident);
      if (session.incidents.length > MAX_INCIDENTS) session.incidents.pop();
      app.server?.publish("incident-event", JSON.stringify({ event: "incident", sessionId: session.id, incident }));
      void captureMainStack(session, incident);
    }

    app.server?.publish("performance-event", JSON.stringify({ event: "performance", session }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "采集器发生未知错误";
    if (activeSession) {
      activeSession.status = "error";
      activeSession.error = message;
      activeSession.updatedAt = new Date().toISOString();
    }
    recordDiagnostic({ level: "error", message: "ADB 采集失败", detail: message });
    app.server?.publish("collector-event", JSON.stringify({
      event: "collector-error",
      message,
    }));
  } finally {
    collecting = false;
  }
}

app.get("/api/health", () => ({
  status: activeSession?.status ?? "waiting",
  collecting,
  activeSessionId: activeSession?.id ?? null,
  target: collectionTarget,
  clickHouse: isClickHouseConfigured() ? "configured" : "memory",
}));

app.get("/api/devices", async () => {
  const devices = await listDevices();
  recordDiagnostic({ level: "info", message: "已扫描 ADB 设备", detail: `发现 ${devices.length} 个已授权设备` });
  return { devices };
});

app.get("/api/devices/:id/packages", async ({ params, set }) => {
  const deviceId = decodeURIComponent(params.id);
  if (!validAdbIdentifier(deviceId) || !(await listDevices()).some((device) => device.id === deviceId)) {
    recordDiagnostic({ level: "warning", message: "包名查询失败", detail: "所选设备当前未处于 ADB 已连接状态" });
    set.status = 404;
    return { error: "设备当前不可用" };
  }
  const packages = await listPackages(deviceId);
  recordDiagnostic({ level: "info", message: "已读取第三方应用列表", detail: `${deviceId} · ${packages.length} 个包名` });
  return { packages };
});

app.post("/api/collector/connect", async ({ body, set }) => {
  const target = body as Partial<CollectionTarget>;
  if (!validAdbIdentifier(target.deviceId) || !validAdbIdentifier(target.packageName)) {
    recordDiagnostic({ level: "warning", message: "连接参数无效", detail: "请选择有效设备和第三方应用包名" });
    set.status = 400;
    return { error: "设备或包名格式无效" };
  }
  if (!(await listDevices()).some((device) => device.id === target.deviceId)) {
    recordDiagnostic({ level: "warning", message: "连接设备不可用", detail: "刷新设备列表后重新选择目标" });
    set.status = 404;
    return { error: "设备当前不可用，请刷新设备列表" };
  }
  if (!(await listPackages(target.deviceId)).includes(target.packageName)) {
    recordDiagnostic({ level: "warning", message: "连接包名不可用", detail: "重新读取所选设备的第三方应用列表" });
    set.status = 404;
    return { error: "包名不属于所选设备的第三方应用" };
  }

  collectionTarget = { deviceId: target.deviceId, packageName: target.packageName };
  activeSession = null;
  refreshRateCache = { deviceId: "", value: 60, updatedAt: 0 };
  recordDiagnostic({ level: "success", message: "采集目标已连接", detail: `${target.deviceId} · ${target.packageName}` });
  return { connected: true, target: collectionTarget };
});

app.get("/api/sessions", () => ({ activeSession, sessions: [...sessions.values()] }));

app.get("/api/diagnostics", () => ({ entries: diagnostics }));

app.get("/api/sessions/:id", ({ params }) => (
  sessions.get(params.id) ?? { error: "会话不存在" }
));

app.ws("/ws", {
  open(ws) {
    ws.subscribe("performance-event");
    ws.subscribe("incident-event");
    ws.subscribe("stack-event");
    ws.subscribe("collector-event");
    ws.subscribe("diagnostic-event");
    if (activeSession) ws.send(JSON.stringify({ event: "performance", session: activeSession }));
    ws.send(JSON.stringify({ event: "diagnostics", entries: diagnostics }));
  },
});

setInterval(() => void collectPerformance(), SAMPLE_INTERVAL_MS);
void collectPerformance();

const port = 3001;
app.listen(port);
console.log(`Performance dashboard: http://127.0.0.1:${port}`);
