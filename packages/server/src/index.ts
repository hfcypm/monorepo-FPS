import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { $ } from "bun";
import { existsSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";
import { classifyWindow, parseFrameCosts, percentile, type Severity } from "./metrics";
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
  source: "adb" | "sdk";
  appVersion?: string;
  androidVersion?: string;
  scene?: string;
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

type PerformanceIngestPayload = {
  sessionId?: string;
  deviceId: string;
  packageName: string;
  appVersion: string;
  androidVersion: string;
  scene: string;
  refreshRate: number;
  windowMs: number;
  totalFrames: number;
  jankFrames: number;
  frozenFrames: number;
  averageFrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
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
let refreshRateCache = { value: 60, updatedAt: 0 };

async function getForegroundPackage() {
  const text = await $`${adbPath} shell dumpsys window`.text();
  return text.match(/mCurrentFocus.*?([\w.]+)\//)?.[1] ?? null;
}

async function getDeviceId() {
  try {
    const deviceId = (await $`${adbPath} get-serialno`.text()).trim();
    return deviceId || "adb-device";
  } catch {
    return "adb-device";
  }
}

async function getRefreshRate() {
  const now = Date.now();
  if (now - refreshRateCache.updatedAt < 30_000) return refreshRateCache.value;

  try {
    const text = await $`${adbPath} shell settings get system peak_refresh_rate`.text();
    const refreshRate = Number.parseFloat(text);
    if (Number.isFinite(refreshRate) && refreshRate >= 30 && refreshRate <= 240) {
      refreshRateCache = { value: refreshRate, updatedAt: now };
    }
  } catch {
    refreshRateCache.updatedAt = now;
  }

  return refreshRateCache.value;
}

async function ensureSession(packageName: string, refreshRate: number) {
  if (activeSession?.packageName === packageName) {
    activeSession.refreshRate = refreshRate;
    return activeSession;
  }

  activeSession = {
    id: randomUUID(),
    deviceId: await getDeviceId(),
    packageName,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    refreshRate,
    source: "adb",
    status: "collecting",
    totals: { frames: 0, jankFrames: 0, frozenFrames: 0 },
    windows: [],
    incidents: [],
  };
  sessions.set(activeSession.id, activeSession);

  await $`${adbPath} shell dumpsys gfxinfo ${packageName} reset`.quiet();
  return activeSession;
}

async function captureMainStack(session: PerformanceSession, incident: PerformanceIncident) {
  if (Date.now() - lastStackCaptureAt < STACK_CAPTURE_COOLDOWN_MS) return;
  lastStackCaptureAt = Date.now();

  try {
    const pid = (await $`${adbPath} shell pidof ${session.packageName}`.text()).trim();
    if (!pid) throw new Error("未获取到应用进程");

    const stack = await $`${adbPath} shell dumpsys thread ${pid} main`.text();
    incident.stack = stack.substring(0, 7000);
    app.server?.publish("stack-event", JSON.stringify({ event: "stack", sessionId: session.id, incident }));
  } catch (error) {
    incident.stack = `主线程堆栈采集失败：${error instanceof Error ? error.message : "未知错误"}`;
  }
}

function persistWindow(session: PerformanceSession, window: PerformanceWindow) {
  void persistPerformanceWindow({
    sessionId: session.id,
    source: session.source,
    deviceId: session.deviceId,
    packageName: session.packageName,
    appVersion: session.appVersion,
    androidVersion: session.androidVersion,
    scene: session.scene,
    ...window,
  }).catch((error) => console.error(error));
}

function validPayload(payload: Partial<PerformanceIngestPayload>): payload is PerformanceIngestPayload {
  const numbers = [
    payload.refreshRate,
    payload.windowMs,
    payload.totalFrames,
    payload.jankFrames,
    payload.frozenFrames,
    payload.averageFrameMs,
    payload.p95FrameMs,
    payload.p99FrameMs,
  ];
  return [payload.deviceId, payload.packageName, payload.appVersion, payload.androidVersion, payload.scene]
    .every((value) => typeof value === "string" && value.length > 0)
    && numbers.every((value) => typeof value === "number" && Number.isFinite(value))
    && (payload.refreshRate ?? 0) >= 30
    && (payload.totalFrames ?? 0) > 0
    && (payload.averageFrameMs ?? 0) > 0
    && (payload.jankFrames ?? 0) <= (payload.totalFrames ?? 0)
    && (payload.frozenFrames ?? 0) <= (payload.totalFrames ?? 0);
}

function ingestSdkWindow(payload: PerformanceIngestPayload) {
  const id = payload.sessionId ?? randomUUID();
  let session = sessions.get(id);
  const timestamp = new Date().toISOString();
  if (!session) {
    session = {
      id,
      deviceId: payload.deviceId,
      packageName: payload.packageName,
      startedAt: timestamp,
      updatedAt: timestamp,
      refreshRate: payload.refreshRate,
      source: "sdk",
      appVersion: payload.appVersion,
      androidVersion: payload.androidVersion,
      scene: payload.scene,
      status: "collecting",
      totals: { frames: 0, jankFrames: 0, frozenFrames: 0 },
      windows: [],
      incidents: [],
    };
    sessions.set(id, session);
  }

  const jankRate = (payload.jankFrames / payload.totalFrames) * 100;
  const window: PerformanceWindow = {
    timestamp,
    fps: Math.min(payload.refreshRate, Math.round(1000 / payload.averageFrameMs)),
    refreshRate: payload.refreshRate,
    frameBudgetMs: 1000 / payload.refreshRate,
    totalFrames: payload.totalFrames,
    jankFrames: payload.jankFrames,
    frozenFrames: payload.frozenFrames,
    averageFrameMs: payload.averageFrameMs,
    p95FrameMs: payload.p95FrameMs,
    p99FrameMs: payload.p99FrameMs,
    jankRate,
    severity: classifyWindow(jankRate, payload.frozenFrames),
  };
  session.updatedAt = timestamp;
  session.refreshRate = payload.refreshRate;
  session.scene = payload.scene;
  session.totals.frames += window.totalFrames;
  session.totals.jankFrames += window.jankFrames;
  session.totals.frozenFrames += window.frozenFrames;
  session.windows.push(window);
  if (session.windows.length > MAX_WINDOWS) session.windows.shift();
  activeSession = session;
  persistWindow(session, window);
  app.server?.publish("performance-event", JSON.stringify({ event: "performance", session }));
  return session;
}

async function collectPerformance() {
  if (collecting) return;
  collecting = true;

  try {
    const packageName = await getForegroundPackage();
    if (!packageName) {
      if (activeSession) activeSession.status = "waiting";
      return;
    }

    const refreshRate = await getRefreshRate();
    const session = await ensureSession(packageName, refreshRate);
    const raw = await $`${adbPath} shell dumpsys gfxinfo ${packageName} framestats`.text();
    const frameCosts = parseFrameCosts(raw);
    await $`${adbPath} shell dumpsys gfxinfo ${packageName} reset`.quiet();

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
  clickHouse: isClickHouseConfigured() ? "configured" : "memory",
}));

app.get("/api/sessions", () => ({ activeSession, sessions: [...sessions.values()] }));

app.get("/api/sessions/:id", ({ params }) => (
  sessions.get(params.id) ?? { error: "会话不存在" }
));

app.post("/api/ingest/windows", ({ body, headers, set }) => {
  const ingestionToken = process.env.PERFORMANCE_INGEST_TOKEN;
  if (ingestionToken && headers.authorization !== `Bearer ${ingestionToken}`) {
    set.status = 401;
    return { error: "上报凭证无效" };
  }
  const payload = body as Partial<PerformanceIngestPayload>;
  if (!validPayload(payload)) {
    set.status = 400;
    return { error: "性能窗口字段无效" };
  }
  const session = ingestSdkWindow(payload);
  return { accepted: true, sessionId: session.id };
});

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
