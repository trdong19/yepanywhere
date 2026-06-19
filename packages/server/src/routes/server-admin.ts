import type { Stats } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { Hono } from "hono";
import { highlightFile } from "../highlighting/index.js";
import { renderMarkdownToHtml } from "../augments/markdown-augments.js";
import { markDevReloadRequested } from "../dev-reload-signal.js";
import type { NotificationService } from "../notifications/index.js";
import type { Supervisor } from "../supervisor/Supervisor.js";

export interface ServerAdminDeps {
  supervisor: Supervisor;
  notificationService?: NotificationService;
}

/**
 * Administrative routes for server management.
 * Always mounted (not dev-mode-only), so remote relay clients can use them.
 */
export function createServerAdminRoutes(deps: ServerAdminDeps): Hono {
  const routes = new Hono();

  // POST /api/server/restart - Trigger graceful server restart
  routes.post("/restart", async (c) => {
    console.log("[ServerAdmin] Restart requested via API");

    await deps.notificationService?.flush();
    markDevReloadRequested();

    // Respond before exiting
    const response = c.json({
      ok: true,
      message: "Server restarting...",
    });

    // Schedule exit after response is sent.
    // Process supervisor (scripts/dev.js, systemd, pm2) will restart the process.
    setTimeout(() => {
      process.exit(0);
    }, 100);

    return response;
  });

  /**
   * GET /api/server/browse-dirs?path=/some/dir
   * List directories at the given path for project path autocomplete.
   */
  routes.get("/browse-dirs", async (c) => {
    let dirPath = c.req.query("path") || homedir();

    // Expand ~ to home directory
    if (dirPath === "~") {
      dirPath = homedir();
    } else if (dirPath.startsWith("~/")) {
      dirPath = join(homedir(), dirPath.slice(2));
    }

    // Resolve to absolute path
    const resolved = isAbsolute(dirPath) ? resolve(dirPath) : resolve(homedir(), dirPath);

    try {
      const entries = await readdir(resolved, { withFileTypes: true });
      const dirs = await Promise.all(
        entries
          .filter((e) => e.isDirectory() && !e.name.startsWith("."))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(async (entry) => {
            const fullPath = join(resolved, entry.name);
            // Check if it's a git repo (has .git dir)
            try {
              const s = await stat(join(fullPath, ".git"));
              return { name: entry.name, path: fullPath, isGitRepo: s.isDirectory() };
            } catch {
              return { name: entry.name, path: fullPath, isGitRepo: false };
            }
          }),
      );

      return c.json({ path: resolved, entries: dirs });
    } catch (err: any) {
      return c.json({ error: err.message || "Failed to read directory" }, 400);
    }
  });

  // ── Standalone File Manager APIs ──────────────────────────────────

  const TEXT_EXTENSIONS = new Set([
    ".txt", ".md", ".ts", ".tsx", ".js", ".jsx", ".json", ".html", ".css",
    ".scss", ".yaml", ".yml", ".toml", ".sh", ".py", ".rb", ".go", ".rs",
    ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".swift", ".php", ".lua",
    ".sql", ".xml", ".svg", ".env", ".gitignore", ".dockerfile", ".makefile",
    ".vue", ".svelte", ".log", ".csv", ".lock", ".ini", ".conf", ".cfg",
  ]);

  function isTextFile(filePath: string): boolean {
    const ext = extname(filePath).toLowerCase();
    return ext ? TEXT_EXTENSIONS.has(ext) : false;
  }

  function getMimeType(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    const map: Record<string, string> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
      ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
      ".pdf": "application/pdf", ".zip": "application/zip",
      ".mp3": "audio/mpeg", ".mp4": "video/mp4", ".woff2": "font/woff2",
    };
    return map[ext] ?? "application/octet-stream";
  }

  function isPathInsideDirectory(filePath: string, directory: string): boolean {
    const rel = relative(resolve(directory), resolve(filePath));
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  }

  async function resolveSafePath(requestedPath: string): Promise<string | null> {
    let p = requestedPath;
    if (p === "~") p = homedir();
    else if (p.startsWith("~/")) p = join(homedir(), p.slice(2));
    const resolved = isAbsolute(p) ? resolve(p) : resolve(homedir(), p);
    return (await realpath(resolved).catch(() => null)) ?? resolved;
  }

  /**
   * GET /files/list?path=...
   */
  routes.get("/files/list", async (c) => {
    const dirPath = await resolveSafePath(c.req.query("path") || "/");
    if (!dirPath) return c.json({ error: "Invalid path" }, 400);

    let dirStats: Stats;
    try { dirStats = await stat(dirPath); } catch {
      return c.json({ error: "Path not found" }, 404);
    }
    if (!dirStats.isDirectory()) return c.json({ error: "Not a directory" }, 400);

    const entries = await readdir(dirPath, { withFileTypes: true });
    const result = await Promise.all(
      entries
        .filter(e => !e.name.startsWith("."))
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name);
        })
        .map(async entry => {
          const fullPath = resolve(dirPath, entry.name);
          const s = await stat(fullPath).catch(() => null);
          return {
            name: entry.name,
            isDir: entry.isDirectory(),
            size: s?.size ?? 0,
            path: fullPath,
          };
        }),
    );
    return c.json({ entries: result });
  });

  /**
   * GET /files?path=...&highlight=true
   */
  routes.get("/files", async (c) => {
    const filePath = await resolveSafePath(c.req.query("path") || "");
    if (!filePath) return c.json({ error: "Invalid path" }, 400);

    let stats: Stats;
    try { stats = await stat(filePath); } catch {
      return c.json({ error: "File not found" }, 404);
    }
    if (!stats.isFile()) return c.json({ error: "Not a file" }, 400);

    const isText = isTextFile(filePath);
    const response: Record<string, unknown> = {
      metadata: { path: filePath, size: stats.size, mimeType: getMimeType(filePath), isText },
    };

    if (isText && stats.size <= 2 * 1024 * 1024) {
      try {
        const content = await readFile(filePath, "utf-8");
        response.content = content;
        if (c.req.query("highlight") === "true") {
          const result = await highlightFile(content, filePath);
          if (result) response.highlightedHtml = result.html;
          const ext = extname(filePath).toLowerCase();
          if (ext === ".md" || ext === ".markdown") {
            try {
              response.renderedMarkdownHtml = await renderMarkdownToHtml(content, {
                localFileBasePath: dirname(filePath),
              });
            } catch { /* ignore */ }
          }
        }
      } catch { /* ignore */ }
    }

    return c.json(response);
  });

  /**
   * POST /files/create
   */
  routes.post("/files/create", async (c) => {
    let body: { kind: string; name: string; parent: string };
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    if (!body.name || !body.parent) return c.json({ error: "Missing name or parent" }, 400);
    if (body.name.includes("/") || body.name.includes("\\")) return c.json({ error: "Invalid name" }, 400);

    const parentPath = await resolveSafePath(body.parent);
    if (!parentPath) return c.json({ error: "Invalid parent" }, 400);
    const newPath = resolve(parentPath, body.name);

    try {
      if (body.kind === "dir") await mkdir(newPath, { recursive: true });
      else await writeFile(newPath, "", "utf-8");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create";
      return c.json({ error: msg }, 500);
    }
    return c.json({ ok: true, path: newPath });
  });

  /**
   * PUT /files
   */
  routes.put("/files", async (c) => {
    let body: { path: string; content: string };
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    if (!body.path || body.content === undefined) return c.json({ error: "Missing path or content" }, 400);

    const filePath = await resolveSafePath(body.path);
    if (!filePath) return c.json({ error: "Invalid path" }, 400);

    try { await writeFile(filePath, body.content, "utf-8"); }
    catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      return c.json({ error: msg }, 500);
    }
    return c.json({ ok: true });
  });

  /**
   * DELETE /files?path=...
   */
  routes.delete("/files", async (c) => {
    const filePath = await resolveSafePath(c.req.query("path") || "");
    if (!filePath) return c.json({ error: "Invalid path" }, 400);
    if (resolve(filePath) === "/") return c.json({ error: "Cannot delete root" }, 400);

    try { await rm(filePath, { recursive: true }); }
    catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete";
      return c.json({ error: msg }, 500);
    }
    return c.json({ ok: true });
  });

  /**
   * POST /files/rename
   */
  routes.post("/files/rename", async (c) => {
    let body: { path: string; newName: string };
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    if (!body.path || !body.newName) return c.json({ error: "Missing path or newName" }, 400);
    if (body.newName.includes("/") || body.newName.includes("\\")) return c.json({ error: "Invalid name" }, 400);

    const oldPath = await resolveSafePath(body.path);
    if (!oldPath) return c.json({ error: "Invalid path" }, 400);
    const newPath = resolve(dirname(oldPath), body.newName);

    try { await rename(oldPath, newPath); }
    catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to rename";
      return c.json({ error: msg }, 500);
    }
    return c.json({ ok: true, path: newPath });
  });

  /**
   * POST /files/upload
   * Uploads a file to a directory via multipart form data.
   * Fields: file (File), dir (string - destination directory path)
   */
  routes.post("/files/upload", async (c) => {
    const body = await c.req.parseBody();
    const file = body["file"];
    const dirPath = body["dir"];

    if (!file || !(file instanceof File)) return c.json({ error: "Missing file" }, 400);
    if (typeof dirPath !== "string" || !dirPath) return c.json({ error: "Missing dir" }, 400);

    const resolvedDir = await resolveSafePath(dirPath);
    if (!resolvedDir) return c.json({ error: "Invalid dir" }, 400);

    let dirStats: Stats;
    try { dirStats = await stat(resolvedDir); } catch {
      return c.json({ error: "Directory not found" }, 404);
    }
    if (!dirStats.isDirectory()) return c.json({ error: "Not a directory" }, 400);

    const fileName = file.name;
    if (!fileName || fileName.includes("/") || fileName.includes("\\")) {
      return c.json({ error: "Invalid file name" }, 400);
    }

    const destPath = resolve(resolvedDir, fileName);
    const buffer = Buffer.from(await file.arrayBuffer());

    try {
      await writeFile(destPath, buffer);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to upload";
      return c.json({ error: msg }, 500);
    }
    return c.json({ ok: true, path: destPath, name: fileName, size: buffer.length });
  });

  /**
   * GET /files/raw?path=...
   * Streams a binary file with the correct Content-Type (for image preview etc.)
   */
  routes.get("/files/raw", async (c) => {
    const filePath = await resolveSafePath(c.req.query("path") || "");
    if (!filePath) return c.json({ error: "Invalid path" }, 400);

    let fileStats: Stats;
    try { fileStats = await stat(filePath); } catch {
      return c.json({ error: "File not found" }, 404);
    }
    if (!fileStats.isFile()) return c.json({ error: "Not a file" }, 400);

    const mime = getMimeType(filePath);
    const data = await readFile(filePath);
    return new Response(data, {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(fileStats.size),
        "Cache-Control": "private, max-age=60",
      },
    });
  });

  /**
   * POST /files/copy
   * Copies a file or directory to a destination directory.
   */
  routes.post("/files/copy", async (c) => {
    let body: { source: string; destDir: string; newName?: string };
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    if (!body.source || !body.destDir) return c.json({ error: "Missing source or destDir" }, 400);

    const srcPath = await resolveSafePath(body.source);
    if (!srcPath) return c.json({ error: "Invalid source" }, 400);
    const destDir = await resolveSafePath(body.destDir);
    if (!destDir) return c.json({ error: "Invalid destDir" }, 400);

    const name = body.newName || basename(srcPath);
    if (name.includes("/") || name.includes("\\")) return c.json({ error: "Invalid name" }, 400);
    const destPath = resolve(destDir, name);

    // Prevent copying a directory into itself
    if (srcPath === destPath || isPathInsideDirectory(destPath, srcPath)) {
      return c.json({ error: "Cannot copy a directory into itself" }, 400);
    }

    try {
      const srcStats = await stat(srcPath);
      if (srcStats.isDirectory()) {
        await cp(srcPath, destPath, { recursive: true });
      } else {
        await cp(srcPath, destPath);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to copy";
      return c.json({ error: msg }, 500);
    }
    return c.json({ ok: true, path: destPath });
  });

  /**
   * POST /files/move
   * Moves (renames) a file or directory to a destination directory.
   */
  routes.post("/files/move", async (c) => {
    let body: { source: string; destDir: string; newName?: string };
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    if (!body.source || !body.destDir) return c.json({ error: "Missing source or destDir" }, 400);

    const srcPath = await resolveSafePath(body.source);
    if (!srcPath) return c.json({ error: "Invalid source" }, 400);
    const destDir = await resolveSafePath(body.destDir);
    if (!destDir) return c.json({ error: "Invalid destDir" }, 400);

    const name = body.newName || basename(srcPath);
    if (name.includes("/") || name.includes("\\")) return c.json({ error: "Invalid name" }, 400);
    const destPath = resolve(destDir, name);

    if (srcPath === destPath) return c.json({ error: "Source and destination are the same" }, 400);
    if (resolve(srcPath) === "/") return c.json({ error: "Cannot move root" }, 400);

    try {
      await rename(srcPath, destPath);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to move";
      return c.json({ error: msg }, 500);
    }
    return c.json({ ok: true, path: destPath });
  });

  /**
   * POST /files/batch-delete
   * Deletes multiple files/directories. Body: { paths: string[] }
   */
  routes.post("/files/batch-delete", async (c) => {
    let body: { paths: string[] };
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    if (!Array.isArray(body.paths) || body.paths.length === 0) return c.json({ error: "Missing paths" }, 400);

    const errors: string[] = [];
    for (const p of body.paths) {
      const resolved = await resolveSafePath(p);
      if (!resolved) { errors.push(`${p}: invalid path`); continue; }
      if (resolve(resolved) === "/") { errors.push(`${p}: cannot delete root`); continue; }
      try { await rm(resolved, { recursive: true }); }
      catch (err: unknown) { errors.push(`${p}: ${err instanceof Error ? err.message : "failed"}`); }
    }
    return c.json({ ok: errors.length === 0, errors });
  });

  /**
   * POST /files/batch-copy
   * Copies multiple files/dirs to a destination directory. Body: { sources: string[], destDir: string }
   */
  routes.post("/files/batch-copy", async (c) => {
    let body: { sources: string[]; destDir: string };
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    if (!Array.isArray(body.sources) || !body.destDir) return c.json({ error: "Missing sources or destDir" }, 400);

    const destDir = await resolveSafePath(body.destDir);
    if (!destDir) return c.json({ error: "Invalid destDir" }, 400);

    const errors: string[] = [];
    for (const src of body.sources) {
      const srcPath = await resolveSafePath(src);
      if (!srcPath) { errors.push(`${src}: invalid path`); continue; }
      const name = basename(srcPath);
      const destPath = resolve(destDir, name);
      if (srcPath === destPath || isPathInsideDirectory(destPath, srcPath)) {
        errors.push(`${src}: cannot copy into itself`); continue;
      }
      try {
        const s = await stat(srcPath);
        await cp(srcPath, destPath, s.isDirectory() ? { recursive: true } : undefined);
      } catch (err: unknown) { errors.push(`${src}: ${err instanceof Error ? err.message : "failed"}`); }
    }
    return c.json({ ok: errors.length === 0, errors });
  });

  /**
   * POST /files/batch-move
   * Moves multiple files/dirs to a destination directory. Body: { sources: string[], destDir: string }
   */
  routes.post("/files/batch-move", async (c) => {
    let body: { sources: string[]; destDir: string };
    try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
    if (!Array.isArray(body.sources) || !body.destDir) return c.json({ error: "Missing sources or destDir" }, 400);

    const destDir = await resolveSafePath(body.destDir);
    if (!destDir) return c.json({ error: "Invalid destDir" }, 400);

    const errors: string[] = [];
    for (const src of body.sources) {
      const srcPath = await resolveSafePath(src);
      if (!srcPath) { errors.push(`${src}: invalid path`); continue; }
      const name = basename(srcPath);
      const destPath = resolve(destDir, name);
      if (srcPath === destPath) { errors.push(`${src}: same destination`); continue; }
      try { await rename(srcPath, destPath); }
      catch (err: unknown) { errors.push(`${src}: ${err instanceof Error ? err.message : "failed"}`); }
    }
    return c.json({ ok: errors.length === 0, errors });
  });

  return routes;
}
