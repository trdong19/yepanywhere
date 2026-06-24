/**
 * NtfyService - Sends ntfy.sh-compatible push notifications for session events
 *
 * Listens to EventBus for process state changes and POSTs to a configurable
 * ntfy server when a session completes, needs input, or terminates.
 *
 * @see https://ntfy.sh/docs/publish/
 */

import { basename } from "node:path";
import type { UrlProjectId } from "@yep-anywhere/shared";
import type { SessionMetadataService } from "../metadata/SessionMetadataService.js";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";
import type { Supervisor } from "../supervisor/Supervisor.js";
import type { InputRequest } from "../supervisor/types.js";
import type {
  BusEvent,
  EventBus,
  ProcessStateEvent,
  ProcessTerminatedEvent,
  SessionAbortedEvent,
} from "../watcher/EventBus.js";

export interface NtfyServiceOptions {
  eventBus: EventBus;
  supervisor: Supervisor;
  serverSettingsService: ServerSettingsService;
  sessionMetadataService?: SessionMetadataService;
}

export class NtfyService {
  private readonly unsubscribe: () => void;
  private readonly options: NtfyServiceOptions;
  /** Sessions intentionally aborted by this server; suppress push. */
  private abortedSessions = new Set<string>();

  constructor(options: NtfyServiceOptions) {
    this.options = options;
    this.unsubscribe = options.eventBus.subscribe((event: BusEvent) => {
      void this.handleEvent(event);
    });
  }

  dispose(): void {
    this.unsubscribe();
  }

  private async handleEvent(event: BusEvent): Promise<void> {
    if (event.type === "process-state-changed") {
      await this.handleProcessStateChange(event);
      return;
    }

    if (event.type === "process-terminated") {
      await this.handleProcessTerminated(event);
      return;
    }

    if (event.type === "session-aborted") {
      this.abortedSessions.add(event.sessionId);
    }
  }

  private async handleProcessStateChange(
    event: ProcessStateEvent,
  ): Promise<void> {
    // Clear aborted flag when a session resumes active work
    if (event.activity === "in-turn" || event.activity === "waiting-input") {
      this.abortedSessions.delete(event.sessionId);
    }

    if (event.activity === "idle") {
      // Skip synthetic idle during unregister cleanup
      if (this.abortedSessions.delete(event.sessionId)) {
        return;
      }
      const process = this.options.supervisor.getProcessForSession(
        event.sessionId,
      );
      if (process?.state.type !== "idle") {
        return;
      }
      await this.send({
        sessionId: event.sessionId,
        projectId: event.projectId,
        message: "回答完成✅",
        reason: "completed",
      });
      return;
    }

    if (event.activity === "waiting-input") {
      const process = this.options.supervisor.getProcessForSession(
        event.sessionId,
      );
      if (process?.state.type !== "waiting-input") {
        return;
      }
      const request = process.state.request;
      const summary = this.buildSummary(request);
      const inputType =
        request.type === "tool-approval" ? "需要工具审批" : "需要回答问题";
      await this.send({
        sessionId: event.sessionId,
        projectId: event.projectId,
        message: `${inputType}: ${summary}⏳`,
        reason: "waiting-input",
      });
    }
  }

  private async handleProcessTerminated(
    event: ProcessTerminatedEvent,
  ): Promise<void> {
    if (this.abortedSessions.delete(event.sessionId)) {
      return;
    }
    await this.send({
      sessionId: event.sessionId,
      projectId: event.projectId,
      message: "会话异常终止❌",
      reason: "error",
    });
  }

  private async send(input: {
    sessionId: string;
    projectId: UrlProjectId;
    message: string;
    reason: string;
  }): Promise<void> {
    const settings = this.options.serverSettingsService.getSettings();
    if (!settings.ntfyEnabled) {
      return;
    }

    const serverUrl = settings.ntfyUrl?.trim() || "https://ntfy.kdns.fr";
    const topic = settings.ntfyTopic?.trim() || "claude";
    const sessionTitle = this.getSessionTitle(input.sessionId);
    const url = `${serverUrl.replace(/\/+$/, "")}/${topic}`;

    const title = sessionTitle || "Yep Anywhere";

    // Build notification body with optional session link
    let body = `${title}\n${input.message}`;
    let clickUrl: string | undefined;
    if (settings.ntfySessionLink !== false) {
      const baseUrl = this.resolveBaseUrl(settings);
      if (baseUrl) {
        clickUrl = `${baseUrl}/projects/${input.projectId}/sessions/${input.sessionId}`;
        body += `\n${clickUrl}`;
      }
    }

    try {
      const headers: Record<string, string> = {
        "content-type": "text/plain; charset=utf-8",
      };
      if (clickUrl) {
        headers.Click = clickUrl;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
      });

      if (!response.ok) {
        console.error(
          `[Ntfy] Request failed with status ${response.status} for session ${input.sessionId}`,
        );
      } else {
        console.log(
          `[Ntfy] Sent for session ${input.sessionId} (${input.reason})`,
        );
      }
    } catch (error) {
      console.error("[Ntfy] Request failed:", error);
    }
  }

  /**
   * Send a test notification to verify ntfy configuration.
   * Returns true if the notification was sent successfully.
   */
  async sendTest(): Promise<{ success: boolean; error?: string }> {
    const settings = this.options.serverSettingsService.getSettings();
    if (!settings.ntfyEnabled) {
      return { success: false, error: "ntfy is not enabled" };
    }

    const serverUrl = settings.ntfyUrl?.trim() || "https://ntfy.kdns.fr";
    const topic = settings.ntfyTopic?.trim() || "claude";
    const url = `${serverUrl.replace(/\/+$/, "")}/${topic}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: `测试通知🔔\nntfy 配置成功！`,
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private resolveBaseUrl(
    settings: import("../services/ServerSettingsService.js").ServerSettings,
  ): string | null {
    // Use explicit server URL if configured
    if (settings.serverUrl) {
      return settings.serverUrl.replace(/\/+$/, "");
    }

    // Construct from HOST/PORT environment variables
    const host = process.env.HOST || "127.0.0.1";
    const port = process.env.PORT || "3400";

    // Replace 0.0.0.0 with localhost for clickable URL
    const displayHost = host === "0.0.0.0" ? "localhost" : host;

    // Use HTTPS if TLS is configured, otherwise HTTP
    const protocol =
      process.env.TLS_CERT_PATH || process.env.HTTPS ? "https" : "http";

    return `${protocol}://${displayHost}:${port}`;
  }

  private getSessionTitle(sessionId: string): string | null {
    // Try custom title from metadata first
    const metadata = this.options.sessionMetadataService?.getMetadata(sessionId);
    if (metadata?.customTitle) {
      return metadata.customTitle;
    }

    // Fall back to first user message as title
    const process = this.options.supervisor.getProcessForSession(sessionId);
    if (!process) return null;

    const history = process.getMessageHistory();
    for (const msg of history) {
      if (msg.type === "user" && typeof msg.message?.content === "string") {
        const text = msg.message.content.trim();
        if (text) {
          return text.length > 80 ? `${text.slice(0, 77)}...` : text;
        }
      }
    }
    return null;
  }

  private buildSummary(request: InputRequest): string {
    if (request.type === "tool-approval") {
      const toolName = request.toolName ?? "Unknown tool";
      if (request.toolInput && typeof request.toolInput === "object") {
        const input = request.toolInput as Record<string, unknown>;
        const filePath = input.file_path ?? input.filePath ?? input.path;
        if (typeof filePath === "string") {
          return `${toolName}: ${basename(filePath)}`;
        }
      }
      return `Run: ${toolName}`;
    }
    const prompt = request.prompt ?? "Waiting for input";
    if (prompt.length > 60) {
      return `${prompt.slice(0, 57)}...`;
    }
    return prompt;
  }
}
