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
  source: "adb" | "sdk";
  appVersion?: string;
  androidVersion?: string;
  scene?: string;
  status: "collecting" | "waiting" | "error";
  error?: string;
  totals: { frames: number; jankFrames: number; frozenFrames: number };
  windows: PerformanceWindow[];
  incidents: Incident[];
};

const severityLabel: Record<Severity, string> = { normal: "稳定", medium: "关注", high: "高风险", critical: "严重" };

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

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

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

  useEffect(() => {
    let socket: WebSocket | undefined;
    let retryTimer: number | undefined;
    let disposed = false;
    const loadSession = async () => {
      try {
        const response = await fetch("/api/sessions");
        const payload = await response.json() as { activeSession: Session | null };
        if (payload.activeSession) setSession(payload.activeSession);
      } catch { setCollectorMessage("会话服务暂不可用，正在等待实时连接"); }
    };
    const connect = () => {
      socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      socket.onopen = () => { setConnected(true); setCollectorMessage("实时采集链路已建立"); };
      socket.onmessage = (event) => {
        const payload = JSON.parse(event.data) as { event: string; session?: Session; incident?: Incident; message?: string };
        if (payload.event === "performance" && payload.session) setSession(payload.session);
        if ((payload.event === "incident" || payload.event === "stack") && payload.incident) setSelectedIncident(payload.incident);
        if (payload.event === "collector-error") setCollectorMessage(payload.message ?? "采集器异常");
      };
      socket.onclose = () => { setConnected(false); if (!disposed) retryTimer = window.setTimeout(connect, 2000); };
    };
    void loadSession();
    connect();
    return () => { disposed = true; if (retryTimer) window.clearTimeout(retryTimer); socket?.close(); };
  }, []);

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

        <section className="session-banner">
          <div className="session-symbol"><Icon name="devices" /></div>
          <div className="session-main"><span className="section-kicker">ACTIVE DEVICE SESSION</span><h2>{session?.packageName ?? "等待当前前台应用"}</h2><div className="session-meta"><span>{device}</span><em /> <span>{session?.source === "sdk" ? "SDK 上报" : "ADB 本地诊断"}</span><em /> <span>{session?.scene ?? "未标记场景"}</span></div></div>
          <div className="session-tags"><span className={`status-chip status-${severity}`}>{severityLabel[severity]}</span><span className="session-id">{session?.appVersion ?? "本地会话"}</span></div>
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
