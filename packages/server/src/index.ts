import { Elysia } from "elysia";
import { greet } from "@my-monorepo/shared";

const app = new Elysia()
  .get("/", () => {
    return new Response(
      `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Monorepo</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #e0e0e0;
    }
    .container {
      text-align: center;
      padding: 48px;
      border-radius: 16px;
      background: rgba(255,255,255,0.05);
      backdrop-filter: blur(12px);
      border: 1px solid rgba(255,255,255,0.1);
    }
    h1 { font-size: 2rem; margin-bottom: 12px; color: #f0f0f0; }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 20px;
      border-radius: 24px;
      background: rgba(76, 175, 80, 0.15);
      color: #4caf50;
      font-weight: 600;
      margin: 16px 0;
    }
    .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #4caf50;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .info { color: #888; font-size: 0.9rem; margin-top: 24px; }
    .info span { color: #aaa; font-weight: 500; }
  </style>
</head>
<body>
  <div class="container">
    <h1>My Monorepo</h1>
    <div class="status">
      <span class="dot"></span>
      ${greet("Monorepo")}
    </div>
    <p>Elysia + Bun Monorepo 运行正常</p>
    <div class="info">
      <p>Runtime: <span>Bun</span></p>
      <p>Framework: <span>Elysia</span></p>
      <p>Port: <span>3001</span></p>
    </div>
  </div>
</body>
</html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  })
  .get("/api/hello", () => ({
    message: greet("Monorepo"),
  }))
  .listen(3001);

console.log(`Server running at ${app.server?.url}`);
