import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { $ } from "bun";
import { existsSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";
import { classifyWindow, parseConnectedDevices, parseFrameCosts, parseThirdPartyPackages, percentile, type Severity } from "./metrics";
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

const app = new Elysia().use(staticPlugin({ assets: "dist", prefix: "/" }));

for (const directory of ["./logs", "./traces", "./dist"]) {
  if (!existsSync(directory)) mkdirSync(directory);
}

const SAMPLE_INTERVAL_MS = 1000;
const MAX_WINDOWS = 150;
const MAX_INCIDENTS = 30;
const STACK_CAPTURE_COOLDOWN_MS = 10_000;
const adbPath = process.env.ADB_PATH ?? "adb";

let activeSession: PerformanceSession | null = null;
const sessions = new Map<string, PerformanceSession>();
let collecting = false;
let lastStackCaptureAt = 0;
let refreshRateCache = { deviceId: "", value: 60, updatedAt: 0 };
let collectionTarget: CollectionTarget | null = null;

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
      return;
    }

    const devices = await listDevices();
    if (!devices.some((device) => device.id === collectionTarget?.deviceId)) {
      throw new Error("所选设备当前未处于 ADB 已连接状态");
    }

    const refreshRate = await getRefreshRate(collectionTarget.deviceId);
    const session = await ensureSession(collectionTarget, refreshRate);
    const raw = await $`${adbPath} -s ${collectionTarget.deviceId} shell dumpsys gfxinfo ${collectionTarget.packageName} framestats`.text();
    const frameCosts = parseFrameCosts(raw);
    await $`${adbPath} -s ${collectionTarget.deviceId} shell dumpsys gfxinfo ${collectionTarget.packageName} reset`.quiet();

    if (frameCosts.length === 0) return;

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
    if (activeSession) {
      activeSession.status = "error";
      activeSession.error = error instanceof Error ? error.message : "采集器发生未知错误";
      activeSession.updatedAt = new Date().toISOString();
    }
    app.server?.publish("collector-event", JSON.stringify({
      event: "collector-error",
      message: error instanceof Error ? error.message : "采集器发生未知错误",
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

app.get("/api/devices", async () => ({ devices: await listDevices() }));

app.get("/api/devices/:id/packages", async ({ params, set }) => {
  const deviceId = decodeURIComponent(params.id);
  if (!validAdbIdentifier(deviceId) || !(await listDevices()).some((device) => device.id === deviceId)) {
    set.status = 404;
    return { error: "设备当前不可用" };
  }
  return { packages: await listPackages(deviceId) };
});

app.post("/api/collector/connect", async ({ body, set }) => {
  const target = body as Partial<CollectionTarget>;
  if (!validAdbIdentifier(target.deviceId) || !validAdbIdentifier(target.packageName)) {
    set.status = 400;
    return { error: "设备或包名格式无效" };
  }
  if (!(await listDevices()).some((device) => device.id === target.deviceId)) {
    set.status = 404;
    return { error: "设备当前不可用，请刷新设备列表" };
  }
  if (!(await listPackages(target.deviceId)).includes(target.packageName)) {
    set.status = 404;
    return { error: "包名不属于所选设备的第三方应用" };
  }

  collectionTarget = { deviceId: target.deviceId, packageName: target.packageName };
  activeSession = null;
  refreshRateCache = { deviceId: "", value: 60, updatedAt: 0 };
  return { connected: true, target: collectionTarget };
});

app.get("/api/sessions", () => ({ activeSession, sessions: [...sessions.values()] }));

app.get("/api/sessions/:id", ({ params }) => (
  sessions.get(params.id) ?? { error: "会话不存在" }
));

app.ws("/ws", {
  open(ws) {
    ws.subscribe("performance-event");
    ws.subscribe("incident-event");
    ws.subscribe("stack-event");
    ws.subscribe("collector-event");
    if (activeSession) ws.send(JSON.stringify({ event: "performance", session: activeSession }));
  },
});

setInterval(() => void collectPerformance(), SAMPLE_INTERVAL_MS);
void collectPerformance();

const port = 3001;
app.listen(port);
console.log(`Performance dashboard: http://127.0.0.1:${port}`);
