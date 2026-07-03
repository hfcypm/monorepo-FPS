import { greet } from "@my-monorepo/shared";

const server = Bun.serve({
  port: 3001,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/api/hello") {
      return Response.json({ message: greet("Monorepo") });
    }
    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running at ${server.url}`);
