import { useEffect, useRef, useState } from "react";

type Severity = "normal" | "medium" | "high" | "critical";

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

type Incident = {
  id: string;
  timestamp: string;
  severity: Exclude<Severity, "normal">;
  reason: string;
  frameMs: number;
  stack?: string;
};

type Session = {
  id: string;
  deviceId: string;
  packageName: string;
  startedAt: string;
  updatedAt: string;
  refreshRate: number;
  status: "collecting" | "waiting" | "error";
  error?: string;
  totals: { frames: number; jankFrames: number; frozenFrames: number };
  windows: PerformanceWindow[];
  incidents: Incident[];
};

type Device = {
  id: string;
  model: string;
};

type DiagnosticEntry = {
  id: string;
  timestamp: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
  detail?: string;
};

// 服务端风险枚举映射为看板可读状态。
const severityLabel: Record<Severity, string> = { normal: "稳定", medium: "关注", high: "高风险", critical: "严重" };

// 统一输出看板内的本地化时分秒格式。
function formatTime(value?: string) {
  if (!value) return "--";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value));
}

function Icon({ name }: { name: "overview" | "pulse" | "devices" | "alerts" | "settings" | "more" | "arrow" }) {
  const paths = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    pulse: <polyline points="3 12 7 12 10 5 14 19 17 12 21 12" />,
    devices: <><rect x="6" y="2" width="12" height="20" rx="2" /><line x1="10" y1="18" x2="14" y2="18" /></>,
    alerts: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.04 1.56V20h-3v-.08A1.7 1.7 0 0 0 10.66 18.36a1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7 14.7a1.7 1.7 0 0 0-1.56-1.04H5.3v-3h.08A1.7 1.7 0 0 0 6.94 9.62 1.7 1.7 0 0 0 6.6 7.74l-.06-.06 2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 11.64 4.4V4.3h3v.08A1.7 1.7 0 0 0 15.68 5.94a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0 0 19.34 9.6a1.7 1.7 0 0 0 1.56 1.04h.1v3h-.08A1.7 1.7 0 0 0 19.4 15Z" /></>,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="19" cy="12" r="1" fill="currentColor" /></>,
    arrow: <polyline points="9 18 15 12 9 6" />,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">{paths[name]}</svg>;
}

function TrendChart({ windows, refreshRate }: { windows: PerformanceWindow[]; refreshRate: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 绘制日志与 WebSocket 日志共同定位 FPS 数据停留的链路阶段。
  useEffect(() => {
    const latest = windows.at(-1);
    if (latest) console.info("[FPS Render] 已绘制 FPS 趋势窗口", { windowCount: windows.length, fps: latest.fps, timestamp: latest.timestamp });
  }, [windows]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    // 根据 CSS 尺寸和设备像素比重建画布，保持高分屏下的趋势线清晰。
    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const { width, height } = rect;
      const padding = { top: 18, right: 16, bottom: 28, left: 38 };
      const chartWidth = width - padding.left - padding.right;
      const chartHeight = height - padding.top - padding.bottom;
      const maxValue = Math.max(60, refreshRate || 60);
      const x = (index: number) => padding.left + index / Math.max(windows.length - 1, 1) * chartWidth;
      const y = (value: number) => padding.top + chartHeight - Math.min(value, maxValue) / maxValue * chartHeight;

      context.clearRect(0, 0, width, height);
      context.font = "11px Inter, ui-sans-serif";
      context.strokeStyle = "#e7edf5";
      context.fillStyle = "#8b97a9";
      for (const ratioValue of [0, 0.5, 1]) {
        const lineY = padding.top + chartHeight * (1 - ratioValue);
        context.beginPath();
        context.moveTo(padding.left, lineY);
        context.lineTo(width - padding.right, lineY);
        context.stroke();
        context.fillText(`${Math.round(maxValue * ratioValue)}`, 5, lineY + 4);
      }

      // 空窗口时保留可解释的占位状态，避免用户误认为图表组件失效。
      if (windows.length === 0) {
        context.fillStyle = "#97a3b6";
        context.fillText("等待 ADB 采集到前台应用的帧数据", padding.left, height / 2);
        return;
      }

      const targetY = y(maxValue * 0.9);
      context.setLineDash([5, 5]);
      context.strokeStyle = "#f2b84b";
      context.beginPath();
      context.moveTo(padding.left, targetY);
      context.lineTo(width - padding.right, targetY);
      context.stroke();
      context.setLineDash([]);

      const fill = context.createLinearGradient(0, padding.top, 0, height - padding.bottom);
      fill.addColorStop(0, "rgba(33, 145, 255, 0.26)");
      fill.addColorStop(1, "rgba(33, 145, 255, 0)");
      context.beginPath();
      windows.forEach((item, index) => index === 0 ? context.moveTo(x(index), y(item.fps)) : context.lineTo(x(index), y(item.fps)));
      context.lineTo(x(windows.length - 1), height - padding.bottom);
      context.lineTo(padding.left, height - padding.bottom);
      context.closePath();
      context.fillStyle = fill;
      context.fill();

      context.beginPath();
      windows.forEach((item, index) => index === 0 ? context.moveTo(x(index), y(item.fps)) : context.lineTo(x(index), y(item.fps)));
      context.strokeStyle = "#1677ff";
      context.lineWidth = 2.5;
      context.stroke();
      const last = windows.at(-1);
      if (last) {
        context.beginPath();
        context.fillStyle = last.severity === "normal" ? "#1eb980" : "#e46e50";
        context.arc(x(windows.length - 1), y(last.fps), 4, 0, Math.PI * 2);
        context.fill();
      }
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [refreshRate, windows]);

  return <canvas ref={canvasRef} className="trend-canvas" aria-label="帧率趋势图" />;
}

function Metric({ label, value, detail, tone = "blue" }: { label: string; value: string; detail: string; tone?: "blue" | "green" | "orange" | "red" }) {
  return <article className={`metric-card metric-${tone}`}><div className="metric-label">{label}</div><strong>{value}</strong><span>{detail}</span></article>;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [connected, setConnected] = useState(false);
  const [collectorMessage, setCollectorMessage] = useState("等待本地采集器连接");
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [packages, setPackages] = useState<string[]>([]);
  const [selectedDevice, setSelectedDevice] = useState("");
  const [selectedPackage, setSelectedPackage] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);
  const [targetMessage, setTargetMessage] = useState("刷新设备列表后选择诊断目标");
  const [diagnostics, setDiagnostics] = useState<DiagnosticEntry[]>([]);
  // 采集目标切换后递增版本号，触发 WebSocket Effect 清理旧通道并重新连接。
  const [connectionEpoch, setConnectionEpoch] = useState(0);

  useEffect(() => {
    let socket: WebSocket | undefined;
    let retryTimer: number | undefined;
    let disposed = false;
    // WebSocket 建立前先恢复已有会话和诊断记录，缩短页面首屏空白时间。
    const loadSession = async () => {
      try {
        const response = await fetch("/api/sessions");
        const payload = await response.json() as { activeSession: Session | null };
        if (payload.activeSession) setSession(payload.activeSession);
      } catch { setCollectorMessage("会话服务暂不可用，正在等待实时连接"); }
    };
    const loadDiagnostics = async () => {
      try {
        const response = await fetch("/api/diagnostics");
        const payload = await response.json() as { entries?: DiagnosticEntry[] };
        if (response.ok) setDiagnostics(payload.entries ?? []);
      } catch { /* WebSocket reconnect supplies diagnostics. */ }
    };
    const connect = () => {
      // 本地开发绕开 Vite WebSocket 代理，部署环境保持同源连接。
      const socketOrigin = import.meta.env.DEV
        ? "ws://localhost:3001"
        : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
      const socketUrl = `${socketOrigin}/ws`;
      console.info("[Collector WebSocket] 正在连接", { socketUrl, reason: connectionEpoch ? "采集目标已更新" : "页面初始化" });
      socket = new WebSocket(socketUrl);
      socket.onopen = () => {
        console.info("[Collector WebSocket] 连接成功", { socketUrl });
        setConnected(true);
        setCollectorMessage("实时采集链路已建立");
      };
      socket.onmessage = (event) => {
        const payload = JSON.parse(event.data) as { event: string; session?: Session; incident?: Incident; message?: string; entry?: DiagnosticEntry; entries?: DiagnosticEntry[] };
        // 性能事件携带完整会话快照，可一次更新全部指标和趋势数据。
        if (payload.event === "performance" && payload.session) {
          const latest = payload.session.windows.at(-1);
          console.info("[FPS WebSocket] 已接收性能窗口", { sessionId: payload.session.id, windowCount: payload.session.windows.length, fps: latest?.fps });
          setSession(payload.session);
        }
        if ((payload.event === "incident" || payload.event === "stack") && payload.incident) setSelectedIncident(payload.incident);
        if (payload.event === "collector-error") {
          console.error("[Collector WebSocket] 服务端采集异常", payload.message ?? "采集器异常");
          setCollectorMessage(payload.message ?? "采集器异常");
        }
        if (payload.event === "diagnostics" && payload.entries) setDiagnostics(payload.entries);
        // 将服务端诊断等级映射为对应控制台级别，便于按异常筛选。
        if (payload.event === "diagnostic" && payload.entry) {
          const { entry } = payload;
          console[entry.level === "error" ? "error" : entry.level === "warning" ? "warn" : "info"]("[Collector Diagnostic]", entry.message, entry.detail ?? "");
          setDiagnostics((entries) => [entry, ...entries.filter((item) => item.id !== entry.id)].slice(0, 80));
        }
      };
      socket.onerror = (event) => console.error("[Collector WebSocket] 连接失败", { socketUrl, event });
      socket.onclose = (event) => {
        setConnected(false);
        if (disposed) return;
        console.warn("[Collector WebSocket] 连接关闭，2 秒后重试", { socketUrl, code: event.code, reason: event.reason });
        retryTimer = window.setTimeout(connect, 2000);
      };
    };
    void loadSession();
    void loadDiagnostics();
    connect();
    // 切换采集目标或卸载页面时取消重试，避免旧连接覆盖新连接状态。
    return () => { disposed = true; if (retryTimer) window.clearTimeout(retryTimer); socket?.close(); };
  }, [connectionEpoch]);

  // 刷新设备列表后保留仍可用的选择，失效时默认选择首个设备。
  const refreshDevices = async () => {
    try {
      const response = await fetch("/api/devices");
      const payload = await response.json() as { devices?: Device[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "设备列表加载失败");
      const availableDevices = payload.devices ?? [];
      setDevices(availableDevices);
      setSelectedDevice((current) => availableDevices.some((device) => device.id === current) ? current : (availableDevices[0]?.id ?? ""));
      setTargetMessage(availableDevices.length ? "请选择应用包名并发起连接" : "未发现 ADB 已授权设备");
    } catch (error) {
      setTargetMessage(error instanceof Error ? error.message : "设备列表加载失败");
    }
  };

  useEffect(() => { void refreshDevices(); }, []);

  // 设备变化后加载对应第三方应用列表，并清空已失效的包名选择。
  useEffect(() => {
    if (!selectedDevice) {
      setPackages([]);
      setSelectedPackage("");
      return;
    }
    const loadPackages = async () => {
      try {
        const response = await fetch(`/api/devices/${encodeURIComponent(selectedDevice)}/packages`);
        const payload = await response.json() as { packages?: string[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "包名列表加载失败");
        const availablePackages = payload.packages ?? [];
        setPackages(availablePackages);
        setSelectedPackage((current) => availablePackages.includes(current) ? current : (availablePackages[0] ?? ""));
      } catch (error) {
        setPackages([]);
        setSelectedPackage("");
        setTargetMessage(error instanceof Error ? error.message : "包名列表加载失败");
      }
    };
    void loadPackages();
  }, [selectedDevice]);

  // 服务端确认采集目标后，清空旧会话并触发新的实时连接。
  const connectTarget = async () => {
    if (!selectedDevice || !selectedPackage) return;
    setIsConnecting(true);
    try {
      const response = await fetch("/api/collector/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId: selectedDevice, packageName: selectedPackage }),
      });
      const payload = await response.json() as { connected?: boolean; error?: string };
      if (!response.ok || !payload.connected) throw new Error(payload.error ?? "采集连接失败");
      console.info("[Collector Target] 服务端已确认采集目标", { deviceId: selectedDevice, packageName: selectedPackage });
      setSession(null);
      setTargetMessage(`正在采集 ${selectedPackage}`);
      setConnectionEpoch((epoch) => epoch + 1);
    } catch (error) {
      console.error("[Collector Target] 采集目标连接失败", { deviceId: selectedDevice, packageName: selectedPackage, error });
      setTargetMessage(error instanceof Error ? error.message : "采集连接失败");
    } finally {
      setIsConnecting(false);
    }
  };

  const latest = session?.windows.at(-1);
  const totalFrames = session?.totals.frames ?? 0;
  const jankRate = totalFrames ? ((session?.totals.jankFrames ?? 0) / totalFrames) * 100 : 0;
  const severity = latest?.severity ?? "normal";
  const device = session?.deviceId ?? "等待设备授权";

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">P</span><span>pulse<span className="brand-light">ops</span></span></div>
      <div className="workspace-label">性能工作区</div>
      <nav className="sidebar-nav">
        <a className="nav-item active"><Icon name="overview" />总览</a>
        <a className="nav-item"><Icon name="pulse" />实时监控</a>
        <a className="nav-item"><Icon name="devices" />设备会话</a>
        <a className="nav-item"><Icon name="alerts" />风险中心<span className="nav-count">{session?.incidents.length ?? 0}</span></a>
      </nav>
      <div className="sidebar-spacer" />
      <a className="nav-item"><Icon name="settings" />采集设置</a>
      <div className="operator"><span className="operator-avatar">PE</span><div><b>Performance Eng</b><small>本地诊断环境</small></div><Icon name="more" /></div>
    </aside>

    <section className="workspace">
      <header className="topbar">
        <div className="crumb"><span>应用性能</span><Icon name="arrow" /><b>实时运行态</b></div>
        <div className="top-actions"><span className={`connection ${connected ? "online" : ""}`}><i />{connected ? "实时连接" : "正在重连"}</span><button className="icon-button" aria-label="更多操作"><Icon name="more" /></button></div>
      </header>

      <div className="page-content">
        <section className="page-heading">
          <div><p className="eyebrow">ANDROID PERFORMANCE OBSERVABILITY</p><h1>实时性能概览</h1><p>以当前设备为中心，持续识别帧率波动和高风险渲染窗口。</p></div>
          <div className="updated"><span>最后更新</span><b>{session ? formatTime(session.updatedAt) : collectorMessage}</b></div>
        </section>

        <section className="connection-panel">
          <div className="connection-copy"><span className="section-kicker">COLLECTION TARGET</span><b>连接设备与应用</b><small>{targetMessage}</small></div>
          <label>设备<select value={selectedDevice} onChange={(event) => setSelectedDevice(event.target.value)}><option value="">选择已连接设备</option>{devices.map((item) => <option key={item.id} value={item.id}>{item.model} · {item.id}</option>)}</select></label>
          <label>第三方应用<select value={selectedPackage} onChange={(event) => setSelectedPackage(event.target.value)} disabled={!selectedDevice}><option value="">选择应用包名</option>{packages.map((packageName) => <option key={packageName} value={packageName}>{packageName}</option>)}</select></label>
          <button className="secondary-button" onClick={() => void refreshDevices()} disabled={isConnecting}>刷新设备</button>
          <button className="connect-button" onClick={() => void connectTarget()} disabled={!selectedDevice || !selectedPackage || isConnecting}>{isConnecting ? "连接中..." : "发起连接"}</button>
        </section>

        <section className="diagnostic-log-panel">
          <div className="diagnostic-log-header"><div><span className="section-kicker">CONNECTION & COLLECTION LOG</span><h2>连接与采集日志</h2></div><span>{diagnostics.length} 条</span></div>
          <div className="diagnostic-log-list">{diagnostics.length ? diagnostics.slice(0, 8).map((entry) => <div className={`diagnostic-entry ${entry.level}`} key={entry.id}><time>{formatTime(entry.timestamp)}</time><b>{entry.message}</b><span>{entry.detail}</span></div>) : <div className="diagnostic-empty">等待连接操作和 ADB 采样结果。</div>}</div>
        </section>

        <section className="session-banner">
          <div className="session-symbol"><Icon name="devices" /></div>
          <div className="session-main"><span className="section-kicker">ACTIVE DEVICE SESSION</span><h2>{session?.packageName ?? "等待当前前台应用"}</h2><div className="session-meta"><span>{device}</span><em /> <span>ADB 本地诊断</span></div></div>
          <div className="session-tags"><span className={`status-chip status-${severity}`}>{severityLabel[severity]}</span><span className="session-id">实时采集</span></div>
        </section>

        <section className="metrics-grid">
          <Metric label="当前 FPS" value={latest?.fps ? String(latest.fps) : "--"} detail={`目标 ${session?.refreshRate ?? 60} Hz`} tone="blue" />
          <Metric label="卡顿率" value={`${jankRate.toFixed(1)}%`} detail={`${session?.totals.jankFrames ?? 0} 个卡顿帧`} tone={jankRate >= 8 ? "red" : "green"} />
          <Metric label="P95 帧耗时" value={latest ? `${latest.p95FrameMs.toFixed(1)}ms` : "--"} detail={`预算 ${latest?.frameBudgetMs.toFixed(2) ?? "--"}ms`} tone={latest && latest.p95FrameMs > latest.frameBudgetMs * 2 ? "orange" : "blue"} />
          <Metric label="冻结帧" value={String(session?.totals.frozenFrames ?? 0)} detail="帧耗时超过 700ms" tone={(session?.totals.frozenFrames ?? 0) ? "red" : "green"} />
        </section>

        <section className="dashboard-grid">
          <article className="panel chart-panel">
            <div className="panel-header"><div><span className="section-kicker">FRAME STABILITY</span><h2>帧率趋势</h2></div><div className="chart-legend"><span><i className="legend-line blue" />实时 FPS</span><span><i className="legend-line yellow" />稳定阈值</span></div></div>
            <TrendChart windows={session?.windows ?? []} refreshRate={session?.refreshRate ?? 60} />
            <div className="chart-footer"><span>采样窗口 1 秒</span><span>已累积 {totalFrames.toLocaleString()} 帧</span><span>{session?.windows.length ?? 0} 个有效窗口</span></div>
          </article>

          <article className="panel posture-panel">
            <div className="panel-header"><div><span className="section-kicker">HEALTH POSTURE</span><h2>运行状态</h2></div><button className="text-button">查看规则 <Icon name="arrow" /></button></div>
            <div className="health-score"><div className={`score-ring ${severity}`}><span>{severity === "normal" ? "A" : severity === "medium" ? "B" : "C"}</span></div><div><strong>{severityLabel[severity]}</strong><p>{severity === "normal" ? "当前窗口处于健康范围" : "检测到需要关注的渲染波动"}</p></div></div>
            <div className="health-row"><span>帧预算利用率</span><b>{latest ? `${Math.min(999, Math.round(latest.averageFrameMs / latest.frameBudgetMs * 100))}%` : "--"}</b><div className="progress"><i style={{ width: `${Math.min(100, latest ? latest.averageFrameMs / latest.frameBudgetMs * 100 : 0)}%` }} /></div></div>
            <div className="health-row"><span>高风险事件</span><b>{session?.incidents.length ?? 0}</b><div className="progress danger"><i style={{ width: `${Math.min(100, (session?.incidents.length ?? 0) * 20)}%` }} /></div></div>
          </article>

          <article className="panel incidents-panel">
            <div className="panel-header"><div><span className="section-kicker">RISK QUEUE</span><h2>待处置事件</h2></div><span className="event-total">{session?.incidents.length ?? 0} 条</span></div>
            <div className="incident-list">{session?.incidents.length ? session.incidents.slice(0, 4).map((incident) => <button key={incident.id} className="incident" onClick={() => setSelectedIncident(incident)}><span className={`incident-dot ${incident.severity}`} /><div><b>{incident.reason}</b><small>{formatTime(incident.timestamp)} · 峰值 {incident.frameMs.toFixed(1)}ms</small></div><Icon name="arrow" /></button>) : <div className="empty-state"><span>0</span><b>未发现风险事件</b><p>采集器会持续关注高耗时帧。</p></div>}</div>
          </article>

          <article className="panel diagnostic-panel">
            <div className="panel-header"><div><span className="section-kicker">WINDOW DIAGNOSTICS</span><h2>最近诊断窗口</h2></div><span className="muted">每秒聚合</span></div>
            <div className="table-wrap"><table><thead><tr><th>时间</th><th>FPS</th><th>平均耗时</th><th>P95</th><th>卡顿帧</th><th>风险级别</th></tr></thead><tbody>{(session?.windows ?? []).slice(-6).reverse().map((item) => <tr key={item.timestamp}><td>{formatTime(item.timestamp)}</td><td><b>{item.fps}</b></td><td>{item.averageFrameMs.toFixed(1)}ms</td><td>{item.p95FrameMs.toFixed(1)}ms</td><td>{item.jankFrames}/{item.totalFrames}</td><td><span className={`table-status ${item.severity}`}>{severityLabel[item.severity]}</span></td></tr>)}{!session?.windows.length && <tr><td colSpan={6} className="empty-row">连接设备并打开应用后显示诊断窗口。</td></tr>}</tbody></table></div>
          </article>
        </section>
      </div>
    </section>

    {selectedIncident && <div className="incident-drawer"><div className="drawer-backdrop" onClick={() => setSelectedIncident(null)} /><article className="drawer"><div className="drawer-header"><div><span className="section-kicker">INCIDENT DETAIL</span><h2>{selectedIncident.reason}</h2><p>{formatTime(selectedIncident.timestamp)} · 峰值帧耗时 {selectedIncident.frameMs.toFixed(1)}ms</p></div><button className="icon-button" onClick={() => setSelectedIncident(null)} aria-label="关闭事件详情">×</button></div><div className="stack-label">MAIN THREAD SNAPSHOT</div><pre>{selectedIncident.stack ?? "正在等待主线程诊断结果。"}</pre></article></div>}
  </main>;
}
