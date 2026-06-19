import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import type {
  RelayRequest,
  RelayResponse,
  YepMessage,
} from "@yep-anywhere/shared";
import { decodeJsonFrame, encodeJsonFrame } from "@yep-anywhere/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp } from "../../src/app.js";
import { AuthService } from "../../src/auth/AuthService.js";
import { SESSION_COOKIE_NAME } from "../../src/auth/routes.js";
import { attachUnifiedUpgradeHandler } from "../../src/frontend/index.js";
import { RemoteAccessService } from "../../src/remote-access/index.js";
import { createWsRelayRoutes } from "../../src/routes/ws-relay.js";
import { MockClaudeSDK } from "../../src/sdk/mock.js";
import { UploadManager } from "../../src/uploads/manager.js";
import { EventBus } from "../../src/watcher/index.js";

describe("WebSocket Local Cookie Auth E2E", () => {
  let testDir: string;
  let server: ReturnType<typeof serve>;
  let serverPort: number;
  let cookieHeader: string;
  let mockSdk: MockClaudeSDK;
  let eventBus: EventBus;

  beforeAll(async () => {
    testDir = join(tmpdir(), `ws-local-auth-test-${randomUUID()}`);
    const projectPath = "/home/user/testproject";
    const encodedPath = projectPath.replaceAll("/", "-");

    await mkdir(join(testDir, "localhost", encodedPath), { recursive: true });
    await writeFile(
      join(testDir, "localhost", encodedPath, "test-session.jsonl"),
      `{"type":"user","cwd":"${projectPath}","message":{"content":"Hello"}}\n`,
    );

    const dataDir = join(testDir, "data");
    await mkdir(dataDir, { recursive: true });

    mockSdk = new MockClaudeSDK();
    eventBus = new EventBus();

    const authService = new AuthService({
      dataDir,
      cookieSecret: "ws-local-auth-cookie-secret",
    });
    await authService.initialize();
    await authService.enableAuth("local-auth-password");
    const sessionId = await authService.createSession("ws-local-auth-test");
    cookieHeader = `${SESSION_COOKIE_NAME}=${sessionId}`;

    const remoteAccessService = new RemoteAccessService({ dataDir });
    await remoteAccessService.initialize();
    await remoteAccessService.setRelayConfig({
      url: "wss://test-relay.example.com/ws",
      username: "local-auth-user",
    });
    await remoteAccessService.configure("local-auth-remote-password");

    const { app, supervisor } = createApp({
      sdk: mockSdk,
      projectsDir: testDir,
      eventBus,
      authService,
      authDisabled: false,
    });

    const { upgradeWebSocket, wss } = createNodeWebSocket({ app });
    const baseUrl = "http://localhost:0";
    const uploadManager = new UploadManager({
      uploadsDir: join(testDir, "uploads"),
    });
    const wsRelayHandler = createWsRelayRoutes({
      upgradeWebSocket,
      app,
      baseUrl,
      supervisor,
      eventBus,
      uploadManager,
      remoteAccessService,
    });
    app.get("/api/ws", wsRelayHandler);

    server = serve({ fetch: app.fetch, port: 0 }, (info) => {
      serverPort = info.port;
    });
    attachUnifiedUpgradeHandler(server, {
      frontendProxy: undefined,
      isApiPath: (urlPath) => urlPath.startsWith("/api"),
      app,
      wss,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  });

  afterAll(async () => {
    server?.close();
    await rm(testDir, { recursive: true, force: true });
  });

  function connectWebSocket(cookie?: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${serverPort}/api/ws`, {
        headers: cookie ? { Cookie: cookie } : undefined,
      });
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
      setTimeout(() => reject(new Error("WebSocket connection timeout")), 5000);
    });
  }

  it("allows unauthenticated localhost websocket upgrade (auth handled by SRP)", async () => {
    // The auth middleware skips /api/ws so the WebSocket handler can manage its
    // own auth via SRP. For local_unrestricted connections without remote access
    // credentials, the server responds with srp_not_required.
    const ws = await connectWebSocket();

    // Send srp_hello to trigger the server's auth decision.
    // The server has remote access configured with username "local-auth-user",
    // so we send a valid identity. Since the connection is local_unrestricted,
    // the server responds with srp_not_required (no SRP needed for trusted local connections).
    ws.send(
      JSON.stringify({ type: "srp_hello", identity: "local-auth-user" }),
    );

    const msg = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for SRP response")),
        5000,
      );
      ws.on("message", (data) => {
        try {
          const parsed = JSON.parse(
            typeof data === "string" ? data : data.toString(),
          );
          clearTimeout(timeout);
          resolve(parsed);
        } catch {
          // ignore non-JSON
        }
      });
    });
    // Server should respond with srp_not_required (when no SRP credentials)
    // or srp_challenge (when SRP credentials are configured). Either way,
    // the WebSocket upgrade succeeded — previously it was rejected at HTTP level.
    expect(["srp_not_required", "srp_challenge"]).toContain(msg.type);
    ws.close();
  });

  it("allows cookie-authenticated localhost websocket without SRP handshake", async () => {
    const ws = await connectWebSocket(cookieHeader);
    const request: RelayRequest = {
      type: "request",
      id: randomUUID(),
      method: "GET",
      path: "/health",
    };

    const response = await new Promise<RelayResponse>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Timed out waiting for WS response")),
        5000,
      );

      ws.on("message", (data) => {
        try {
          const msg: YepMessage =
            typeof data === "string"
              ? (JSON.parse(data) as YepMessage)
              : decodeJsonFrame<YepMessage>(data);
          if (msg.type === "response" && msg.id === request.id) {
            clearTimeout(timeout);
            resolve(msg);
          }
        } catch {
          // Ignore unrelated frames
        }
      });

      ws.send(encodeJsonFrame(request));
    });

    expect(response.status).toBe(200);
    ws.close();
  });
});
