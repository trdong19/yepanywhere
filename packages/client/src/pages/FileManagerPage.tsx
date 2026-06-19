import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { api, fetchJSON, getDesktopAuthToken } from "../api/client";
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
  selectedPaths: Set<string>;
  onSelect: (path: string, isDir: boolean, mode: "single" | "toggle" | "range", rangePaths?: string[]) => void;
  onDelete: (paths: string[]) => void;
  onRefresh: () => void;
  refreshKey: number;
  clipboardPaths: string[];
  clipboardMode: "copy" | "cut" | null;
  onCopy: (paths: string[]) => void;
  onCut: (paths: string[]) => void;
  onPaste: (destDir: string) => void;
  onDownload: (paths: string[]) => void;
  onDragStart: (path: string) => void;
  onDragEnd: () => void;
  onDrop: (destDir: string) => void;
  onUpload: (files: FileList, destDir: string) => void;
  onRequestUpload: (destDir: string) => void;
  draggingPath: string | null;
  isLast: boolean;
  parentGuides: boolean[];
  registerVisible: (path: string) => void;
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

function formatSize(bytes: number) {
  if (bytes === 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
}

function isAncestorOf(ancestor: string, path: string) {
  const a = ancestor.endsWith("/") ? ancestor : ancestor + "/";
  return path === ancestor || path.startsWith(a);
}

// Global: close any open context menu before opening a new one
let closeCurrentMenu: (() => void) | null = null;

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 10;

function TreeNode({ entry, depth, selectedPaths, onSelect, onDelete, onRefresh, refreshKey, clipboardPaths, clipboardMode, onCopy, onCut, onPaste, onDownload, onDragStart, onDragEnd, onDrop, onUpload, onRequestUpload, draggingPath, isLast, parentGuides, registerVisible }: TreeProps) {
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
  const isSelected = selectedPaths.has(entry.path);
  const isDragging = draggingPath === entry.path;
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  // Register this node in the visible order on every render
  registerVisible(entry.path);

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
      void loadChildren(false);
    }
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleExpand = useCallback(async () => {
    if (!entry.isDir) return;
    if (!expanded) await loadChildren();
    setExpanded(!expanded);
  }, [entry.isDir, expanded, loadChildren]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (renaming || creating) return;
    if (entry.isDir) {
      void toggleExpand();
    }
    const mode = e.shiftKey ? "range" : e.ctrlKey || e.metaKey ? "toggle" : "single";
    onSelect(entry.path, entry.isDir, mode);
  }, [entry.isDir, entry.path, onSelect, renaming, creating, toggleExpand]);

  // Close menu on click anywhere, or when another menu opens
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
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

  const handleDragOver = (e: React.DragEvent) => {
    if (!entry.isDir) return;
    if (e.dataTransfer.types.includes("Files") && !draggingPath) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
      return;
    }
    if (!draggingPath || isAncestorOf(draggingPath, entry.path)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear highlight when actually leaving this element (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (!entry.isDir) return;
    if (e.dataTransfer.types.includes("Files") && !draggingPath) {
      onUpload(e.dataTransfer.files, entry.path);
      return;
    }
    if (!draggingPath || isAncestorOf(draggingPath, entry.path)) return;
    onDrop(entry.path);
  };

  // Long-press support for mobile touch devices
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      if (!selectedPaths.has(entry.path)) {
        onSelect(entry.path, entry.isDir, "single");
      }
      closeCurrentMenu?.();
      setContextMenu({ x: touch.clientX, y: touch.clientY });
    }, LONG_PRESS_MS);
  }, [entry.path, entry.isDir, selectedPaths, onSelect]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.touches[0];
    const dx = Math.abs(touch.clientX - touchStartRef.current.x);
    const dy = Math.abs(touch.clientY - touchStartRef.current.y);
    if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartRef.current = null;
  }, []);

  // Suppress the click event that fires after a long-press
  const handleClickCapture = useCallback((e: React.MouseEvent) => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  // Context menu helpers
  const hasMulti = selectedPaths.size > 1 && selectedPaths.has(entry.path);
  const effectivePaths = hasMulti ? Array.from(selectedPaths) : [entry.path];

  const guides = [...parentGuides, !isLast];

  return (
    <div className="tree-node">
      <div
        className={`tree-row ${isSelected ? "selected" : ""} ${isDragging ? "tree-dragging" : ""} ${dragOver ? "tree-drag-over" : ""}`}
        style={{ paddingLeft: `${depth * 20 + 4}px` }}
        onClick={handleClick}
        onClickCapture={handleClickCapture}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
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
          // If right-clicked item not in selection, select only it
          if (!selectedPaths.has(entry.path)) {
            onSelect(entry.path, entry.isDir, "single");
          }
          closeCurrentMenu?.();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
      >
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
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {loading ? (
            <div className="tree-loading" style={{ paddingLeft: `${(depth + 1) * 20 + 4}px` }}>加载中...</div>
          ) : (
            children.map((child, idx) => (
              <TreeNode key={child.path} entry={child} depth={depth + 1}
                selectedPaths={selectedPaths} onSelect={onSelect} onDelete={onDelete} onRefresh={onRefresh}
                refreshKey={refreshKey}
                clipboardPaths={clipboardPaths} clipboardMode={clipboardMode}
                onCopy={onCopy} onCut={onCut} onPaste={onPaste} onDownload={onDownload}
                onDragStart={onDragStart} onDragEnd={onDragEnd} onDrop={onDrop}
                onUpload={onUpload} onRequestUpload={onRequestUpload}
                draggingPath={draggingPath}
                isLast={idx === children.length - 1} parentGuides={guides}
                registerVisible={registerVisible} />
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
              <button onClick={() => { onRequestUpload(entry.path); setContextMenu(null); }}>上传到此目录</button>
              <div className="ctx-divider" />
            </>
          )}
          <button onClick={async () => {
            const dirPath = entry.isDir ? entry.path : entry.path.substring(0, entry.path.lastIndexOf("/")) || "/";
            setContextMenu(null);
            try {
              const result = await api.addProject(dirPath);
              window.location.href = `/new-session?projectId=${encodeURIComponent(result.project.id)}`;
            } catch (err) {
              console.error("Failed to create session:", err);
            }
          }}>在此目录新建会话</button>
          <button onClick={() => { onCopy(effectivePaths); setContextMenu(null); }}>
            复制{hasMulti ? ` (${effectivePaths.length})` : ""}
          </button>
          <button onClick={() => { onCut(effectivePaths); setContextMenu(null); }}>
            剪切{hasMulti ? ` (${effectivePaths.length})` : ""}
          </button>
          {clipboardPaths.length > 0 && entry.isDir && (
            <button onClick={() => { onPaste(entry.path); setContextMenu(null); }}>
              粘贴 {clipboardMode === "cut" ? "✂" : "📋"} ({clipboardPaths.length})
            </button>
          )}
          <div className="ctx-divider" />
          <button onClick={() => { setRenaming(true); setContextMenu(null); }}>重命名</button>
          <button onClick={() => {
            navigator.clipboard.writeText(effectivePaths.join("\n"));
            setContextMenu(null);
          }}>复制路径</button>
          <button onClick={() => { onDownload(effectivePaths); setContextMenu(null); }}>
            下载{hasMulti ? ` (${effectivePaths.length})` : ""}
          </button>
          <div className="ctx-divider" />
          <button className="danger" onClick={() => { onDelete(effectivePaths); setContextMenu(null); }}>
            删除{hasMulti ? ` (${effectivePaths.length})` : ""}
          </button>
        </div>
      )}
    </div>
  );
}

interface FileTreeHandle {
  refresh: () => void;
}

const FileTree = forwardRef<FileTreeHandle, {
  selectedPaths: Set<string>;
  onSelect: (path: string, isDir: boolean, mode: "single" | "toggle" | "range", rangePaths?: string[]) => void;
  clipboardPaths: string[];
  clipboardMode: "copy" | "cut" | null;
  onCopy: (paths: string[]) => void;
  onCut: (paths: string[]) => void;
  onPaste: (destDir: string) => void;
  onDownload: (paths: string[]) => void;
  onUpload: (files: FileList, destDir: string) => void;
  onRequestUpload: (destDir: string) => void;
  anchorPath: string | null;
}>(function FileTree({ selectedPaths, onSelect, clipboardPaths, clipboardMode, onCopy, onCut, onPaste, onDownload, onUpload, onRequestUpload, anchorPath }, ref) {
  const [rootEntries, setRootEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [rootMenu, setRootMenu] = useState<{ x: number; y: number } | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);

  // Visible order tracking for range selection.
  // Cleared at the top of each render; TreeNode calls registerVisible during render.
  const visibleOrderRef = useRef<string[]>([]);
  visibleOrderRef.current = [];

  const registerVisible = useCallback((path: string) => {
    visibleOrderRef.current.push(path);
  }, []);

  // Wrap onSelect to handle range selection
  const handleSelect = useCallback((path: string, isDir: boolean, mode: "single" | "toggle" | "range") => {
    if (mode === "range" && anchorPath) {
      // visibleOrderRef was populated during the last render cycle
      const order = visibleOrderRef.current;
      const anchorIdx = order.indexOf(anchorPath);
      const targetIdx = order.indexOf(path);
      if (anchorIdx >= 0 && targetIdx >= 0) {
        const start = Math.min(anchorIdx, targetIdx);
        const end = Math.max(anchorIdx, targetIdx);
        const range = order.slice(start, end + 1);
        onSelect(path, isDir, "range", range);
      }
      return;
    }
    onSelect(path, isDir, mode);
  }, [anchorPath, onSelect]);

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
    void loadRoot(false);
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

  const handleDelete = useCallback(async (paths: string[]) => {
    if (!confirm(`确定删除 ${paths.length} 个项目？`)) return;
    try {
      if (paths.length === 1) {
        await fetchJSON(`/server/files?path=${encodeURIComponent(paths[0]!)}`, { method: "DELETE" });
      } else {
        await fetchJSON("/server/files/batch-delete", {
          method: "POST",
          body: JSON.stringify({ paths }),
        });
      }
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

  const handleTreeDrop = useCallback((e: React.DragEvent) => {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    if (e.dataTransfer.types.includes("Files") && !draggingPath) {
      onUpload(e.dataTransfer.files, "/");
    } else {
      handleDrop("/");
    }
  }, [handleDrop, draggingPath, onUpload]);

  return (
    <div className="file-browser-tree"
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) {
          e.preventDefault();
          closeCurrentMenu?.();
          setRootMenu({ x: e.clientX, y: e.clientY });
        }
      }}
      onDragOver={(e) => {
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = e.dataTransfer.types.includes("Files") && !draggingPath ? "copy" : "move";
      }}
      onDrop={handleTreeDrop}
    >
      {loading ? (
        <div className="tree-loading" style={{ padding: "12px" }}>加载中...</div>
      ) : (
        rootEntries.map((entry, idx) => (
          <TreeNode key={entry.path} entry={entry} depth={0}
            selectedPaths={selectedPaths} onSelect={handleSelect} onDelete={handleDelete} onRefresh={handleRefresh}
            refreshKey={refreshKey}
            clipboardPaths={clipboardPaths} clipboardMode={clipboardMode}
            onCopy={onCopy} onCut={onCut} onPaste={onPaste} onDownload={onDownload}
            onDragStart={setDraggingPath} onDragEnd={() => setDraggingPath(null)} onDrop={handleDrop}
            onUpload={onUpload} onRequestUpload={onRequestUpload}
            draggingPath={draggingPath}
            isLast={idx === rootEntries.length - 1} parentGuides={[]}
            registerVisible={registerVisible} />
        ))
      )}
      {rootMenu && clipboardPaths.length > 0 && (
        <div className="tree-context-menu" style={{ left: rootMenu.x, top: rootMenu.y }}>
          <button onClick={() => { onPaste("/"); setRootMenu(null); }}>
            粘贴到根目录 {clipboardMode === "cut" ? "✂" : "📋"} ({clipboardPaths.length})
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
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 768);
  const [clipboardPaths, setClipboardPaths] = useState<string[]>([]);
  const [clipboardMode, setClipboardMode] = useState<"copy" | "cut" | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(280);
  const [uploadStatus, setUploadStatus] = useState<{ total: number; done: number; errors: string[] } | null>(null);
  const [selectedDir, setSelectedDir] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const anchorPathRef = useRef<string | null>(null);
  const fileTreeRef = useRef<FileTreeHandle>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

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

  const handleSelect = useCallback((path: string, isDir: boolean, mode: "single" | "toggle" | "range", rangePaths?: string[]) => {
    if (mode === "range" && rangePaths) {
      // Range selection: add all range paths to current selection
      setSelectedPaths(prev => {
        const next = new Set(prev);
        for (const p of rangePaths) next.add(p);
        return next;
      });
      return;
    }

    if (mode === "toggle") {
      setSelectedPaths(prev => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return next;
      });
      anchorPathRef.current = path;
      // View the toggled file
      if (!isDir) {
        setSelectedFile(path);
        void loadFile(path);
      }
      return;
    }

    // Single selection: clear all, select this one
    setSelectedPaths(new Set([path]));
    anchorPathRef.current = path;
    if (isDir) {
      setSelectedDir(path);
    } else {
      setSelectedFile(path);
      void loadFile(path);
      if (window.innerWidth <= 768) setSidebarOpen(false);
    }
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

  const handleCopy = useCallback((paths: string[]) => {
    setClipboardPaths(paths);
    setClipboardMode("copy");
  }, []);

  const handleCut = useCallback((paths: string[]) => {
    setClipboardPaths(paths);
    setClipboardMode("cut");
  }, []);

  const handlePaste = useCallback(async (destDir: string) => {
    if (clipboardPaths.length === 0 || !clipboardMode) return;
    const endpoint = clipboardMode === "cut" ? "/server/files/batch-move" : "/server/files/batch-copy";
    try {
      await fetchJSON(endpoint, {
        method: "POST",
        body: JSON.stringify({ sources: clipboardPaths, destDir }),
      });
      if (clipboardMode === "cut") setClipboardPaths([]);
      fileTreeRef.current?.refresh();
    } catch { /* ignore */ }
  }, [clipboardPaths, clipboardMode]);

  const handleDownload = useCallback((paths: string[]) => {
    for (const p of paths) {
      // Only download files (skip directories)
      const a = document.createElement("a");
      a.href = `/api/server/files/raw?path=${encodeURIComponent(p)}`;
      a.download = p.split("/").pop() ?? "download";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }, []);

  const handleUpload = useCallback(async (files: FileList, destDir: string) => {
    const fileArray = Array.from(files);
    setUploadStatus({ total: fileArray.length, done: 0, errors: [] });
    const errors: string[] = [];
    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i]!;
      const formData = new FormData();
      formData.append("file", file);
      formData.append("dir", destDir);
      try {
        const headers: Record<string, string> = { "X-Yep-Anywhere": "true" };
        const desktopToken = getDesktopAuthToken();
        if (desktopToken) headers["X-Desktop-Token"] = desktopToken;
        const res = await fetch("/api/server/files/upload", { method: "POST", body: formData, headers });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          errors.push(`${file.name}: ${(data as { error?: string }).error || res.statusText}`);
        }
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : "上传失败"}`);
      }
      setUploadStatus({ total: fileArray.length, done: i + 1, errors: [...errors] });
    }
    fileTreeRef.current?.refresh();
    setTimeout(() => setUploadStatus(null), 3000);
  }, []);

  const uploadTargetDir = selectedDir
    ?? (selectedFile ? selectedFile.substring(0, selectedFile.lastIndexOf("/")) || "/" : "/");

  const handleUploadClick = useCallback(() => {
    uploadInputRef.current?.click();
  }, []);

  const handleRequestUpload = useCallback((destDir: string) => {
    setSelectedDir(destDir);
    uploadInputRef.current?.click();
  }, []);

  const handleUploadInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void handleUpload(e.target.files, uploadTargetDir);
      e.target.value = "";
    }
  }, [handleUpload, uploadTargetDir]);

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
        {uploadStatus && (
          <div className={`fb-upload-toast ${uploadStatus.errors.length > 0 ? "fb-upload-error" : uploadStatus.done === uploadStatus.total ? "fb-upload-done" : ""}`}>
            {uploadStatus.done < uploadStatus.total
              ? `上传中 ${uploadStatus.done}/${uploadStatus.total}...`
              : uploadStatus.errors.length > 0
                ? `上传完成，${uploadStatus.errors.length} 个失败`
                : `上传完成 ${uploadStatus.total} 个文件`}
          </div>
        )}
        {selectedPaths.size > 1 && (
          <div className="fb-selection-bar">
            已选择 {selectedPaths.size} 项
            <button className="fb-selection-clear" onClick={() => {
              setSelectedPaths(new Set());
              anchorPathRef.current = null;
            }}>✕</button>
          </div>
        )}
        {sidebarOpen && <div className="fb-backdrop" onClick={() => setSidebarOpen(false)} />}

        <div className={`fb-sidebar ${sidebarOpen ? "fb-sidebar-open" : ""}`} style={{ width: `${sidebarWidth}px` }}>
          <div className="fb-sidebar-topbar">
            <span className="fb-sidebar-topbar-title">文件管理</span>
            <div className="fb-sidebar-topbar-actions">
              <button className="fb-sidebar-topbar-btn" title={`上传到 ${uploadTargetDir}`} onClick={handleUploadClick}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </button>
              <button className="fb-sidebar-topbar-btn" title="刷新" onClick={() => fileTreeRef.current?.refresh()}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
              </button>
              <button className="fb-sidebar-topbar-btn fb-sidebar-topbar-close" title="关闭" onClick={() => setSidebarOpen(false)}>✕</button>
            </div>
          </div>
          <input ref={uploadInputRef} type="file" multiple style={{ display: "none" }} onChange={handleUploadInputChange} />
          <FileTree ref={fileTreeRef} selectedPaths={selectedPaths} onSelect={handleSelect}
            clipboardPaths={clipboardPaths} clipboardMode={clipboardMode}
            onCopy={handleCopy} onCut={handleCut} onPaste={handlePaste} onDownload={handleDownload}
            onUpload={handleUpload} onRequestUpload={handleRequestUpload}
            anchorPath={anchorPathRef.current} />
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
