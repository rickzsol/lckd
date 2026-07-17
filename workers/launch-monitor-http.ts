import { createServer, type ServerResponse } from "node:http";
import type { OfficialLaunchEvent } from "../src/lib/launchMonitor";

interface LaunchMonitorHttpOptions {
  allowedOrigin: string;
  epoch: string;
  getHealth: () => { connected: boolean; ready: boolean; subscribed: boolean };
  getLatest: () => OfficialLaunchEvent | null;
  getVersion: () => number;
  onListening: () => void;
  monitoredWallet: string;
  port: number;
}

export interface LaunchMonitorHttpServer {
  broadcast: (event: OfficialLaunchEvent | null) => void;
  close: (callback: () => void) => void;
}

export function startLaunchMonitorHttpServer(
  options: LaunchMonitorHttpOptions,
): LaunchMonitorHttpServer {
  const clients = new Set<ServerResponse>();
  const corsHeaders = {
    "Access-Control-Allow-Origin": options.allowedOrigin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }
    if (request.method !== "GET") {
      response.writeHead(405, { ...corsHeaders, Allow: "GET, OPTIONS" });
      response.end();
      return;
    }
    if (url.pathname === "/health") {
      response.writeHead(200, { ...corsHeaders, "Content-Type": "application/json" });
      response.end(JSON.stringify(options.getHealth()));
      return;
    }
    if (url.pathname === "/ready") {
      const health = options.getHealth();
      response.writeHead(health.ready ? 200 : 503, {
        ...corsHeaders,
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify(health));
      return;
    }
    if (url.pathname === "/latest") {
      response.writeHead(200, {
        ...corsHeaders,
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify({
        launch: options.getLatest(),
        epoch: options.epoch,
        monitoredWallet: options.monitoredWallet,
        version: options.getVersion(),
      }));
      return;
    }
    if (url.pathname === "/events") {
      if (clients.size >= 1_000) {
        response.writeHead(503, { ...corsHeaders, "Retry-After": "5" });
        response.end();
        return;
      }
      response.writeHead(200, {
        ...corsHeaders,
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "Content-Type": "text/event-stream",
        "X-Accel-Buffering": "no",
      });
      response.write("retry: 2000\n\n");
      response.write(`event: state\ndata: ${JSON.stringify({
        epoch: options.epoch,
        launch: options.getLatest(),
        monitoredWallet: options.monitoredWallet,
        version: options.getVersion(),
      })}\n\n`);
      clients.add(response);
      const heartbeat = setInterval(() => {
        if (response.write(": heartbeat\n\n")) return;
        clearInterval(heartbeat);
        clients.delete(response);
        response.end();
      }, 15_000);
      request.on("close", () => {
        clearInterval(heartbeat);
        clients.delete(response);
      });
      return;
    }
    response.writeHead(404, corsHeaders);
    response.end();
  });

  server.listen(options.port, "0.0.0.0", options.onListening);
  return {
    broadcast(event) {
      const payload = `event: state\ndata: ${JSON.stringify({
        epoch: options.epoch,
        launch: event,
        monitoredWallet: options.monitoredWallet,
        version: options.getVersion(),
      })}\n\n`;
      for (const client of clients) {
        if (client.write(payload)) continue;
        clients.delete(client);
        client.end();
      }
    },
    close(callback) {
      for (const client of clients) client.end();
      server.close(callback);
    },
  };
}
