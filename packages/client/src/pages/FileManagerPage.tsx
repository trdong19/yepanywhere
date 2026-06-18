import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { api, fetchJSON } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { useI18n } from "../i18n";
import { MainContent, useNavigationLayout } from "../layouts";
import "./FileBrowserPage.css";

interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
  path: string;
}

// ── Standalone Tree Browser ─────────────────────────────────────

interface TreeProps {
  entry: DirEntry;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string, isDir: boolean) => void;
  onDelete: (path: string) => void;
  onRefresh: () => void;
  refreshKey: number;
  clipboardPath: string | null;
  clipboardMode: "copy" | "cut" | null;
  onCopy: (path: string) => void;
  onCut: (path: string) => void;
  onPaste: (destDir: string) => void;
  onDragStart: (path: string) => void;
  onDragEnd: () => void;
  onDrop: (destDir: string) => void;
  draggingPath: string | null;
  isLast: boolean;
  parentGuides: boolean[];
}

function FileIcon({ isDir }: { isDir: boolean }) {
  if (isDir) {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

function isImageMime(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico"].includes(ext);
}

function isAncestorOf(ancestor: string, path: string) {
  const a = ancestor.endsWith("/") ? ancestor : ancestor + "/";
  return path === ancestor || path.startsWith(a);
}

function formatSize(bytes: number) {
  if (bytes === 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

// Global: close any open context menu before opening a new one
let closeCurrentMenu: (() => void) | null = null;

function TreeNode({ entry, depth, selectedPath, onSelect, onDelete, onRefresh, refreshKey, clipboardPath, clipboardMode, onCopy, onCut, onPaste, onDragStart, onDragEnd, onDrop, draggingPath, isLast, parentGuides }: TreeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(entry.name);
  const [creating, setCreating] = useState<"file" | "dir" | null>(null);
  const [createName, setCreateName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isSelected = selectedPath === entry.path;
  const isDragging = draggingPath === entry.path;

  const loadChildren = useCallback(async (showLoading = true) => {
    if (!entry.isDir) return;
    if (showLoading) setLoading(true);
    try {
      const data = await fetchJSON<{ entries: DirEntry[] }>(
        `/server/files/list?path=${encodeURIComponent(entry.path)}`,
      );
      setChildren(data.entries);
    } catch { /* ignore */ }
    setLoading(false);
  }, [entry.isDir, entry.path]);

  // Re-load children when refreshKey changes (but keep expanded state)
  useEffect(() => {
    if (expanded && entry.isDir) {
      void loadChildren(false); // don't show loading — keep tree intact
    }
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = useCallback(async () => {
    if (!entry.isDir) {
      onSelect(entry.path, false);
      return;
    }
    if (!expanded) await loadChildren();
    setExpanded(!expanded);
    onSelect(entry.path, true);
  }, [entry.isDir, entry.path, expanded, loadChildren, onSelect]);

  // Close menu on click anywhere, or when another menu opens
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    // Register globally so new right-click closes old menu
    closeCurrentMenu?.();
    closeCurrentMenu = close;
    const handler = (e: MouseEvent) => {
      if (e.button === 0) close();
    };
    document.addEventListener("click", handler);
    return () => {
      document.removeEventListener("click", handler);
      if (closeCurrentMenu === close) closeCurrentMenu = null;
    };
  }, [contextMenu]);

  useEffect(() => {
    if ((renaming || creating) && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming, creating]);

  const handleRenameSubmit = async () => {
    if (newName && newName !== entry.name) {
      try {
        await fetchJSON("/server/files/rename", {
          method: "POST",
          body: JSON.stringify({ path: entry.path, newName }),
        });
        onRefresh();
      } catch { /* ignore */ }
    }
    setRenaming(false);
  };

  const handleCreateSubmit = async () => {
    if (createName && creating) {
      try {
        await fetchJSON("/server/files/create", {
          method: "POST",
          body: JSON.stringify({ kind: creating, name: createName, parent: entry.path }),
        });
        await loadChildren();
        onRefresh();
      } catch { /* ignore */ }
    }
    setCreating(null);
    setCreateName("");
  };

  // Check if `child` is an ancestor of (or equal to) `path`
  const isAncestorOf = (ancestor: string, path: string) => {
    const a = ancestor.endsWith("/") ? ancestor : ancestor + "/";
    const p = path;
    return p === ancestor || p.startsWith(a);
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!entry.isDir) return;
    if (!draggingPath || isAncestorOf(draggingPath, entry.path)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!entry.isDir) return;
    if (!draggingPath || isAncestorOf(draggingPath, entry.path)) return;
    onDrop(entry.path);
  };

  // Build indentation guides
  const guides = [...parentGuides, !isLast];

  return (
    <div className="tree-node">
      <div
        className={`tree-row ${isSelected ? "selected" : ""} ${isDragging ? "tree-dragging" : ""} ${dragOver ? "tree-drag-over" : ""}`}
        style={{ paddingLeft: `${depth * 20 + 4}px` }}
        onClick={toggleExpand}
        draggable={!renaming && !creating}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", entry.path);
          onDragStart(entry.path);
        }}
        onDragEnd={onDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          closeCurrentMenu?.(); // close any existing menu first
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {/* Indentation guides */}
        {depth > 0 && (
          <span className="tree-guides" aria-hidden="true">
            {guides.map((showLine, i) => (
              <span
                key={i}
                className={`tree-guide ${showLine ? "tree-guide-line" : ""}`}
              />
            ))}
          </span>
        )}
        {entry.isDir ? (
          <span className={`tree-chevron ${expanded ? "expanded" : ""}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
          </span>
        ) : (
          <span className="tree-spacer" />
        )}
        <FileIcon isDir={entry.isDir} />
        {renaming ? (
          <input ref={inputRef} className="tree-inline-input" value={newName}
            onChange={e => setNewName(e.target.value)} onBlur={handleRenameSubmit}
            onKeyDown={e => { if (e.key === "Enter") handleRenameSubmit(); if (e.key === "Escape") setRenaming(false); }}
            onClick={e => e.stopPropagation()} />
        ) : (
          <span className="tree-name" title={entry.name}>{entry.name}</span>
        )}
        {!entry.isDir && entry.size > 0 && <span className="tree-size">{formatSize(entry.size)}</span>}
      </div>

      {expanded && creating && (
        <div className="tree-row" style={{ paddingLeft: `${(depth + 1) * 20 + 4}px` }}>
          <span className="tree-guides" aria-hidden="true">
            {guides.map((showLine, i) => (
              <span key={i} className={`tree-guide ${showLine ? "tree-guide-line" : ""}`} />
            ))}
            <span className="tree-guide" />
          </span>
          <span className="tree-spacer" />
          <FileIcon isDir={creating === "dir"} />
          <input ref={inputRef} className="tree-inline-input" placeholder={creating === "dir" ? "新建文件夹..." : "新建文件..."}
            value={createName} onChange={e => setCreateName(e.target.value)} onBlur={handleCreateSubmit}
            onKeyDown={e => { if (e.key === "Enter") handleCreateSubmit(); if (e.key === "Escape") { setCreating(null); setCreateName(""); } }}
            onClick={e => e.stopPropagation()} />
        </div>
      )}

      {expanded && (
        <div
          className="tree-children"
          onDragOver={(e) => {
            if (!entry.isDir || !draggingPath || isAncestorOf(draggingPath, entry.path)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            // Only clear highlight when actually leaving the children container
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDragOver(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (!entry.isDir || !draggingPath || isAncestorOf(draggingPath, entry.path)) return;
            onDrop(entry.path);
          }}
        >
          {loading ? (
            <div className="tree-loading" style={{ paddingLeft: `${(depth + 1) * 20 + 4}px` }}>加载中...</div>
          ) : (
            children.map((child, idx) => (
              <TreeNode key={child.path} entry={child} depth={depth + 1}
                selectedPath={selectedPath} onSelect={onSelect} onDelete={onDelete} onRefresh={onRefresh}
                refreshKey={refreshKey}
                clipboardPath={clipboardPath} clipboardMode={clipboardMode}
                onCopy={onCopy} onCut={onCut} onPaste={onPaste}
                onDragStart={onDragStart} onDragEnd={onDragEnd} onDrop={onDrop}
                draggingPath={draggingPath}
                isLast={idx === children.length - 1} parentGuides={guides} />
            ))
          )}
        </div>
      )}

      {contextMenu && (
        <div className="tree-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {entry.isDir && (
            <>
              <button onClick={() => { setCreating("file"); setContextMenu(null); }}>新建文件</button>
              <button onClick={() => { setCreating("dir"); setContextMenu(null); }}>新建文件夹</button>
              <div className="ctx-divider" />
            </>
          )}
          <button onClick={async () => {
            // For files use parent dir, for dirs use the dir itself
            const dirPath = entry.isDir ? entry.path : entry.path.substring(0, entry.path.lastIndexOf("/")) || "/";
            setContextMenu(null);
            try {
              const result = await api.addProject(dirPath);
              window.location.href = `/new-session?projectId=${encodeURIComponent(result.project.id)}`;
            } catch (err) {
              console.error("Failed to create session:", err);
            }
          }}>在此目录新建会话</button>
          <button onClick={() => { onCopy(entry.path); setContextMenu(null); }}>复制</button>
          <button onClick={() => { onCut(entry.path); setContextMenu(null); }}>剪切</button>
          {clipboardPath && entry.isDir && (
            <button onClick={() => { onPaste(entry.path); setContextMenu(null); }}>
              粘贴 {clipboardMode === "cut" ? "✂" : "📋"}
            </button>
          )}
          <div className="ctx-divider" />
          <button onClick={() => { setRenaming(true); setContextMenu(null); }}>重命名</button>
          <button onClick={() => { navigator.clipboard.writeText(entry.path); setContextMenu(null); }}>复制路径</button>
          <div className="ctx-divider" />
          <button className="danger" onClick={() => { onDelete(entry.path); setContextMenu(null); }}>删除</button>
        </div>
      )}
    </div>
  );
}

interface FileTreeHandle {
  refresh: () => void;
}

const FileTree = forwardRef<FileTreeHandle, {
  selectedPath: string | null;
  onSelect: (path: string, isDir: boolean) => void;
  clipboardPath: string | null;
  clipboardMode: "copy" | "cut" | null;
  onCopy: (path: string) => void;
  onCut: (path: string) => void;
  onPaste: (destDir: string) => void;
}>(function FileTree({ selectedPath, onSelect, clipboardPath, clipboardMode, onCopy, onCut, onPaste }, ref) {
  const [rootEntries, setRootEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [rootMenu, setRootMenu] = useState<{ x: number; y: number } | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);

  const loadRoot = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const data = await fetchJSON<{ entries: DirEntry[] }>(
        `/server/files/list?path=/`,
      );
      setRootEntries(data.entries);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  const handleRefresh = useCallback(() => {
    void loadRoot(false); // don't show loading — keep tree intact
    setRefreshKey(k => k + 1);
  }, [loadRoot]);

  useImperativeHandle(ref, () => ({ refresh: handleRefresh }), [handleRefresh]);
  useEffect(() => { loadRoot(); }, [loadRoot]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!rootMenu) return;
    const close = () => setRootMenu(null);
    closeCurrentMenu?.();
    closeCurrentMenu = close;
    const handler = (e: MouseEvent) => {
      if (e.button === 0) close();
    };
    document.addEventListener("click", handler);
    return () => {
      document.removeEventListener("click", handler);
      if (closeCurrentMenu === close) closeCurrentMenu = null;
    };
  }, [rootMenu]);

  const handleDelete = useCallback(async (path: string) => {
    if (!confirm(`确定删除 ${path}？`)) return;
    try {
      await fetchJSON(`/server/files?path=${encodeURIComponent(path)}`, { method: "DELETE" });
      handleRefresh();
    } catch { /* ignore */ }
  }, [handleRefresh]);

  const handleDrop = useCallback(async (destDir: string) => {
    if (!draggingPath) return;
    try {
      await fetchJSON("/server/files/move", {
        method: "POST",
        body: JSON.stringify({ source: draggingPath, destDir }),
      });
      handleRefresh();
    } catch { /* ignore */ }
    setDraggingPath(null);
  }, [draggingPath, handleRefresh]);

  // Drop on the tree background = move to root
  const handleTreeDrop = useCallback((e: React.DragEvent) => {
    if (e.target === e.currentTarget) {
      e.preventDefault();
      handleDrop("/");
    }
  }, [handleDrop]);

  return (
    <div className="file-browser-tree"
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          closeCurrentMenu?.();
          setRootMenu({ x: e.clientX, y: e.clientY });
        }
      }}
      onDragOver={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; } }}
      onDrop={handleTreeDrop}
    >
      {loading ? (
        <div className="tree-loading" style={{ padding: "12px" }}>加载中...</div>
      ) : (
        rootEntries.map((entry, idx) => (
          <TreeNode key={entry.path} entry={entry} depth={0}
            selectedPath={selectedPath} onSelect={onSelect} onDelete={handleDelete} onRefresh={handleRefresh}
            refreshKey={refreshKey}
            clipboardPath={clipboardPath} clipboardMode={clipboardMode}
            onCopy={onCopy} onCut={onCut} onPaste={onPaste}
            onDragStart={setDraggingPath} onDragEnd={() => setDraggingPath(null)} onDrop={handleDrop}
            draggingPath={draggingPath}
            isLast={idx === rootEntries.length - 1} parentGuides={[]} />
        ))
      )}
      {rootMenu && clipboardPath && (
        <div className="tree-context-menu" style={{ left: rootMenu.x, top: rootMenu.y }}>
          <button onClick={() => { onPaste("/"); setRootMenu(null); }}>
            粘贴到根目录 {clipboardMode === "cut" ? "✂" : "📋"}
          </button>
        </div>
      )}
    </div>
  );
});

// ── File Manager Page ──────────────────────────────────────────

export function FileManagerPage() {
  const { t } = useI18n();
  const { isWideScreen, openSidebar, toggleSidebar, isSidebarCollapsed } = useNavigationLayout();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [renderedMarkdown, setRenderedMarkdown] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"preview" | "edit">("preview");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [isBinary, setIsBinary] = useState(false);
  const [isImage, setIsImage] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [clipboardPath, setClipboardPath] = useState<string | null>(null);
  const [clipboardMode, setClipboardMode] = useState<"copy" | "cut" | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const fileTreeRef = useRef<FileTreeHandle>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(600, startWidth + (ev.clientX - startX)));
      setSidebarWidth(newWidth);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [sidebarWidth]);

  const loadFile = useCallback(async (path: string) => {
    setLoading(true);
    setDirty(false);
    setHighlightedHtml(null);
    setRenderedMarkdown(null);
    setIsBinary(false);
    setIsImage(false);
    setViewMode("preview");
    try {
      const data = await fetchJSON<{
        content?: string;
        metadata?: { isText?: boolean; mimeType?: string };
        highlightedHtml?: string;
        renderedMarkdownHtml?: string;
      }>(`/server/files?path=${encodeURIComponent(path)}&highlight=true`);

      if (data.content !== undefined) {
        setFileContent(data.content);
        setHighlightedHtml(data.highlightedHtml ?? null);
        setRenderedMarkdown(data.renderedMarkdownHtml ?? null);
      } else {
        setIsBinary(true);
        setIsImage(isImageMime(path));
        setFileContent("");
      }
    } catch {
      setFileContent("// 加载失败");
    }
    setLoading(false);
  }, []);

  const handleFileSelect = useCallback((path: string, isDir: boolean) => {
    if (isDir) return;
    setSelectedFile(path);
    void loadFile(path);
    if (window.innerWidth <= 768) setSidebarOpen(false);
  }, [loadFile]);

  const handleSave = useCallback(async (value: string) => {
    if (!selectedFile) return;
    setSaving(true);
    try {
      await fetchJSON("/server/files", {
        method: "PUT",
        body: JSON.stringify({ path: selectedFile, content: value }),
      });
      setDirty(false);
    } catch { /* ignore */ }
    setSaving(false);
  }, [selectedFile]);

  const handleCopy = useCallback((path: string) => {
    setClipboardPath(path);
    setClipboardMode("copy");
  }, []);

  const handleCut = useCallback((path: string) => {
    setClipboardPath(path);
    setClipboardMode("cut");
  }, []);

  const handlePaste = useCallback(async (destDir: string) => {
    if (!clipboardPath || !clipboardMode) return;
    const endpoint = clipboardMode === "cut" ? "/server/files/move" : "/server/files/copy";
    try {
      await fetchJSON(endpoint, {
        method: "POST",
        body: JSON.stringify({ source: clipboardPath, destDir }),
      });
      if (clipboardMode === "cut") setClipboardPath(null);
      fileTreeRef.current?.refresh();
    } catch { /* ignore */ }
  }, [clipboardPath, clipboardMode]);

  const getLanguage = (path: string) => {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const map: Record<string, string> = {
      ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
      json: "JSON", py: "Python", rs: "Rust", go: "Go", html: "HTML",
      css: "CSS", md: "Markdown", sh: "Shell", yaml: "YAML", yml: "YAML",
      toml: "TOML", sql: "SQL", xml: "XML", java: "Java", c: "C",
      cpp: "C++", cs: "C#", rb: "Ruby", php: "PHP", swift: "Swift",
      kt: "Kotlin", dart: "Dart", lua: "Lua",
    };
    return map[ext] ?? "Text";
  };

  return (
    <MainContent isWideScreen={isWideScreen}>
      <PageHeader
        title={t("sidebarFileManager")}
        onOpenSidebar={openSidebar}
        onToggleSidebar={toggleSidebar}
        isWideScreen={isWideScreen}
        isSidebarCollapsed={isSidebarCollapsed}
      />
      <div className="fb-page">
        {sidebarOpen && <div className="fb-backdrop" onClick={() => setSidebarOpen(false)} />}

        <div className={`fb-sidebar ${sidebarOpen ? "fb-sidebar-open" : ""}`} style={{ width: `${sidebarWidth}px` }}>
          <div className="fb-sidebar-topbar">
            <span className="fb-sidebar-topbar-title">文件管理</span>
            <div className="fb-sidebar-topbar-actions">
              <button className="fb-sidebar-topbar-btn" title="刷新" onClick={() => fileTreeRef.current?.refresh()}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </button>
              <button className="fb-sidebar-topbar-btn" title="关闭" onClick={() => setSidebarOpen(false)}>✕</button>
            </div>
          </div>
          <FileTree ref={fileTreeRef} selectedPath={selectedFile} onSelect={handleFileSelect}
            clipboardPath={clipboardPath} clipboardMode={clipboardMode}
            onCopy={handleCopy} onCut={handleCut} onPaste={handlePaste} />
          <div className="fb-sidebar-resize-handle" onMouseDown={handleResizeStart} />
        </div>

        <div className="fb-editor">
          {selectedFile ? (
            <div className="fb-editor-container">
              <div className="fb-editor-header">
                <button className="fb-sidebar-toggle" onClick={() => setSidebarOpen(true)} title="打开文件树">☰</button>
                <span className="fb-editor-path">{selectedFile}</span>
                <div className="fb-editor-actions">
                  {!isBinary && (
                    <>
                      <button className={`fb-tab-btn ${viewMode === "preview" ? "active" : ""}`} onClick={() => setViewMode("preview")}>预览</button>
                      <button className={`fb-tab-btn ${viewMode === "edit" ? "active" : ""}`} onClick={() => setViewMode("edit")}>编辑</button>
                    </>
                  )}
                  {saving && <span className="fb-status">保存中...</span>}
                  {dirty && !saving && <span className="fb-status dirty">未保存</span>}
                  {!dirty && !saving && viewMode === "edit" && <span className="fb-status saved">已保存</span>}
                  {viewMode === "edit" && (
                    <button className="fb-save-btn" onClick={() => handleSave(fileContent)} disabled={!dirty || saving} title="Ctrl+S">保存</button>
                  )}
                </div>
              </div>
              <div className="fb-editor-body">
                {loading ? (
                  <div className="fb-loading">加载中...</div>
                ) : isBinary && isImage ? (
                  <div className="fb-image-preview">
                    <img
                      src={`/api/server/files/raw?path=${encodeURIComponent(selectedFile)}`}
                      alt={selectedFile.split("/").pop() ?? selectedFile}
                    />
                  </div>
                ) : isBinary ? (
                  <div className="fb-empty">
                    <p>二进制文件 — {getLanguage(selectedFile)}</p>
                    <a
                      className="fb-download-link"
                      href={`/api/server/files/raw?path=${encodeURIComponent(selectedFile)}`}
                      download
                    >下载文件</a>
                  </div>
                ) : viewMode === "preview" && renderedMarkdown ? (
                  <div className="fb-preview">
                    <div className="fb-preview-meta"><span>Markdown</span><span>{fileContent.split("\n").length} 行</span></div>
                    <div className="fb-markdown" dangerouslySetInnerHTML={{ __html: renderedMarkdown }} />
                  </div>
                ) : viewMode === "preview" && highlightedHtml ? (
                  <div className="fb-preview">
                    <div className="fb-preview-meta"><span>{getLanguage(selectedFile)}</span><span>{fileContent.split("\n").length} 行</span></div>
                    <div className="fb-highlighted" dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
                  </div>
                ) : viewMode === "preview" ? (
                  <div className="fb-preview">
                    <div className="fb-preview-meta"><span>{getLanguage(selectedFile)}</span><span>{fileContent.split("\n").length} 行</span></div>
                    <pre className="fb-raw-content">{fileContent}</pre>
                  </div>
                ) : (
                  <textarea className="fb-textarea" value={fileContent}
                    onChange={e => { setFileContent(e.target.value); setDirty(true); }}
                    spellCheck={false} />
                )}
              </div>
            </div>
          ) : (
            <div className="fb-empty">
              <button className="fb-sidebar-toggle fb-sidebar-toggle-empty" onClick={() => setSidebarOpen(true)} title="打开文件树">
                ☰ 打开文件管理
              </button>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <p>选择文件查看</p>
            </div>
          )}
        </div>
      </div>
    </MainContent>
  );
}
