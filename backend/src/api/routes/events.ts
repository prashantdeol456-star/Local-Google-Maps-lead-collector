import type { ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import type { EventBus } from "../../services/events.js";

const HEARTBEAT_MS = 25_000;

/** GET /api/events — Server-Sent Events stream of live changes (login required, like every /api route). */
export async function eventRoutes(app: FastifyInstance, opts: { bus: EventBus }) {
  const open = new Set<ServerResponse>();

  // On shutdown, end open streams so the server can close.
  app.addHook("onClose", async () => {
    for (const res of open) res.end();
  });

  app.get("/api/events", (request, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 5000\n\n");
    res.write("event: ready\ndata: {}\n\n");
    open.add(res);

    const unsubscribe = opts.bus.subscribe((event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    // Comment lines keep proxies and the browser from closing an idle connection.
    const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      open.delete(res);
    });
  });
}
