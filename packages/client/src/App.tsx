import { useEffect, useRef, useState } from "react";

type FpsMessage = {
  fps: number;
  list: number[];
  jankRate: string;
  pkg: string;
};

type StackMessage = {
  time: string;
  package: string;
  stack: string;
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fpsInfo, setFpsInfo] = useState<FpsMessage>({
    fps: 60,
    list: [],
    jankRate: "0",
    pkg: "",
  });
  const [stackMsg, setStackMsg] = useState<StackMessage | null>(null);
  const dataRef = useRef<number[]>([]);

  useEffect(() => {
    const ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onmessage = (ev) => {
      const payload = JSON.parse(ev.data);
      if (payload.stack) {
        setStackMsg(payload);
        return;
      }
      setFpsInfo(payload);
      dataRef.current = payload.list;
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let rafId: number;

    function render() {
      const w = canvas.width;
      const h = canvas.height;
      ctx.fillStyle = "#171717";
      ctx.fillRect(0, 0, w, h);

      const arr = dataRef.current;
      const stepX = w / arr.length;

      ctx.strokeStyle = "#facc15";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      const y60 = h - (60 / 120) * h;
      ctx.moveTo(0, y60);
      ctx.lineTo(w, y60);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.strokeStyle = fpsInfo.fps > 55 ? "#4ade80" : "#f87171";
      ctx.lineWidth = 2;
      arr.forEach((val, idx) => {
        const x = idx * stepX;
        const y = h - (val / 120) * h;
        idx === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      rafId = requestAnimationFrame(render);
    }
    render();
    return () => cancelAnimationFrame(rafId);
  }, [fpsInfo.fps]);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4 text-emerald-400">Android FPS 性能检测仪</h1>
      <div className="text-gray-400 mb-2">当前应用：{fpsInfo.pkg || "等待 ADB 连接..."}</div>

      <div className="flex gap-8 my-4 text-xl">
        <div>
          FPS：
          <span className={fpsInfo.fps > 55 ? "text-green-400" : "text-red-400 font-bold"}>
            {fpsInfo.fps}
          </span>
        </div>
        <div>
          卡顿率：
          <span className={Number(fpsInfo.jankRate) > 5 ? "text-red-400" : "text-green-400"}>
            {fpsInfo.jankRate}%
          </span>
        </div>
      </div>

      <canvas ref={canvasRef} width={900} height={340} className="rounded border border-neutral-700 w-full" />
      <p className="text-sm text-gray-500 mt-2">黄色虚线=60帧标准线，帧耗时 18ms判定卡顿</p>

      {stackMsg && (
        <div className="mt-6 border border-red-500 bg-red-950/30 p-4 rounded-lg">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-red-400 font-medium">
              ⚠️ 卡顿捕获 {stackMsg.time} | {stackMsg.package}
            </h3>
            <button onClick={() => setStackMsg(null)} className="px-2 py-1 bg-neutral-700 rounded text-sm">
              关闭
            </button>
          </div>
          <pre className="overflow-auto max-h-72 p-3 bg-black/60 rounded text-xs text-gray-300 whitespace-pre-wrap">
            {stackMsg.stack || "未捕获业务堆栈"}
          </pre>
        </div>
      )}
    </div>
  );
}