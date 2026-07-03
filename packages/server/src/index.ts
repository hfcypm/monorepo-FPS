import { Elysia } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { $ } from "bun";
import { mkdirSync, existsSync } from "fs";

const app = new Elysia()
  .use(staticPlugin({ assets: "dist", prefix: "/" }));

if (!existsSync("./logs")) mkdirSync("./logs");
if (!existsSync("./traces")) mkdirSync("./traces");
if (!existsSync("./dist")) mkdirSync("./dist");

const MAX_POINT = 150;
let frameData: number[] = [];
let jankCount = 0;
let totalFrames = 0;
let captureLock = false;

async function getForegroundPackage() {
  try {
    const text = await $`adb shell dumpsys window | grep mCurrentFocus`.text();
    const ret = text.match(/([\w\.]+)\//);
    return ret ? ret[1] : null;
  } catch {
    return null;
  }
}

async function fetchMainStack(pkg: string) {
  if (captureLock) return;
  captureLock = true;
  try {
    const pidStr = await $`adb shell pidof ${pkg}`.text();
    const pid = pidStr.trim();
    if (!pid) return;

    let stack = await $`adb shell dumpsys thread ${pid} main`.text();
    const lines = stack.split("\n").filter(line => line.includes(pkg));
    stack = lines.join("\n").substring(0, 7000);

    app.server?.publish("stack-event", JSON.stringify({
      time: new Date().toLocaleTimeString(),
      package: pkg,
      stack
    }));
  } catch { } finally {
    setTimeout(() => { captureLock = false; }, 1000);
  }
}

setInterval(async () => {
  const pkg = await getForegroundPackage();
  if (!pkg) return;

  try {
    await $`adb shell dumpsys gfxinfo ${pkg} reset`.quiet();
    const raw = await $`adb shell dumpsys gfxinfo ${pkg} framestats`.text();
    const reg = /Profile data in ms:\n([\s\S]*?)\n\n/;
    const match = raw.match(reg);
    if (!match) return;

    const rows = match[1]!.trim().split("\n");
    let sumCost = 0;
    let count = 0;

    for (const line of rows) {
      const arr = line.trim().split(/\s+/).map(Number);
      const cost = (arr[0] ?? 0) + (arr[1] ?? 0) + (arr[2] ?? 0) + (arr[3] ?? 0);
      if (cost > 0) {
        sumCost += cost;
        count++;
        totalFrames++;
      }
    }

    let fps = 60;
    let avgFrame = 0;
    if (count > 0) {
      avgFrame = sumCost / count;
      fps = Math.min(120, Math.round(1000 / avgFrame));
      if (avgFrame > 18) {
        fetchMainStack(pkg);
      }
    }

    frameData.push(fps);
    if (frameData.length > MAX_POINT) frameData.shift();
    const jankRate = totalFrames > 0 ? (jankCount / totalFrames) * 100 : 0;

    app.server?.publish("fps-event", JSON.stringify({
      fps,
      list: frameData,
      jankRate: jankRate.toFixed(2),
      pkg
    }));
  } catch { }
}, 120);

app.ws("/ws", {
  open(ws) {
    ws.subscribe("fps-event");
    ws.subscribe("stack-event");
  }
});

const PORT = 3001;
app.listen(PORT);
console.log(`✅ 性能面板：http://127.0.0.1:${PORT}`);
console.log("💡 手机开启无线ADB，自动采集帧率，卡顿自动抓取主线程堆栈");