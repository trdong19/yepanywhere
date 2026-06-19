import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { fetchJSON } from "../api/client";
import "./FileBrowser.css";

const LONG_PRESS_MS = 500;
const MOVE_CANCEL_PX = 10;

// Global ref: the close function of the currently open context menu (if any)
let activeMenuCloseFn: (() => void) | null = null;

interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
  path: string;
}

interface TreeNodeProps {
  entry: DirEntry;
  projectId: string;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string, isDir: boolean) => void;
  onDelete: (path: string) => void;
  onRename: (path: string, oldName: string) => void;
  onRefresh: () => void;
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

function TreeNode({ entry, projectId, depth, selectedPath, onSelect, onDelete, onRename, onRefresh }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(entry.name);
  const [creating, setCreating] = useState<"file" | "dir" | null>(null);
  const [createName, setCreateName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);
  const isSelected = selectedPath === entry.path;

  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartRef.current = null;
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    // Close any previously open menu first
    if (activeMenuCloseFn) {
      activeMenuCloseFn();
      activeMenuCloseFn = null;
    }
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      setContextMenu({ x: touch.clientX, y: touch.clientY });
    }, LONG_PRESS_MS);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;
    if (Math.sqrt(dx * dx + dy * dy) > MOVE_CANCEL_PX) {
      clearLongPress();
    }
  }, [clearLongPress]);

  const handleTouchEnd = useCallback(() => {
    clearLongPress();
  }, [clearLongPress]);

  const handleClickCapture = useCallback((e: React.MouseEvent) => {
    if (longPressTriggeredRef.current) {
      e.stopPropagation();
      e.preventDefault();
      longPressTriggeredRef.current = false;
    }
  }, []);

  const loadChildren = useCallback(async () => {
    if (!entry.isDir) return;
    setLoading(true);
    try {
      const data = await fetchJSON<{ entries: DirEntry[] }>(
        `/projects/${projectId}/files/list?path=${encodeURIComponent(entry.path)}`,
      );
      setChildren(data.entries);
    } catch { /* ignore */ }
    setLoading(false);
  }, [entry.isDir, entry.path, projectId]);

  const toggleExpand = useCallback(async () => {
    if (!entry.isDir) {
      onSelect(entry.path, false);
      return;
    }
    if (!expanded) await loadChildren();
    setExpanded(!expanded);
    onSelect(entry.path, true);
  }, [entry.isDir, entry.path, expanded, loadChildren, onSelect]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => {
      setContextMenu(null);
      if (activeMenuCloseFn === close) activeMenuCloseFn = null;
    };
    activeMenuCloseFn = close;
    // Desktop: close on outside click
    document.addEventListener("click", close);
    return () => {
      document.removeEventListener("click", close);
      if (activeMenuCloseFn === close) activeMenuCloseFn = null;
    };
  }, [contextMenu]);

  useEffect(() => clearLongPress, [clearLongPress]);

  useEffect(() => {
    if ((renaming || creating) && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming, creating]);

  const handleRenameSubmit = async () => {
    if (newName && newName !== entry.name) {
      try {
        await fetchJSON(`/projects/${projectId}/files/rename`, {
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
        await fetchJSON(`/projects/${projectId}/files/create`, {
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

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "";
    const units = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / 1024 ** i).toFixed(1)} ${units[i]}`;
  };

  return (
    <div className="tree-node">
      <div
        className={`tree-row ${isSelected ? "selected" : ""}`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
        role="treeitem"
        tabIndex={0}
        onClick={toggleExpand}
        onClickCapture={handleClickCapture}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleExpand(); }}
        onContextMenu={handleContextMenu}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {entry.isDir && (
          <span className={`tree-chevron ${expanded ? "expanded" : ""}`}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="9 18 15 12 9 6" /></svg>
          </span>
        )}
        <FileIcon isDir={entry.isDir} />
        {renaming ? (
          <input ref={inputRef} className="tree-inline-input" value={newName}
            onChange={(e) => setNewName(e.target.value)} onBlur={handleRenameSubmit}
            onKeyDown={(e) => { if (e.key === "Enter") handleRenameSubmit(); if (e.key === "Escape") setRenaming(false); }}
            onClick={(e) => e.stopPropagation()} />
        ) : (
          <span className="tree-name" title={entry.name}>
            {entry.isDir ? entry.name : (() => {
              const dot = entry.name.lastIndexOf(".");
              if (dot <= 0) return entry.name;
              return <><span className="tree-name-base">{entry.name.slice(0, dot)}</span><span className="tree-name-ext">.{entry.name.slice(dot + 1)}</span></>;
            })()}
          </span>
        )}
        {!entry.isDir && entry.size > 0 && <span className="tree-size">{formatSize(entry.size)}</span>}
      </div>

      {expanded && creating && (
        <div className="tree-row" style={{ paddingLeft: `${(depth + 1) * 16 + 4}px` }}>
          <FileIcon isDir={creating === "dir"} />
          <input ref={inputRef} className="tree-inline-input" placeholder={creating === "dir" ? "新建文件夹..." : "新建文件..."}
            value={createName} onChange={(e) => setCreateName(e.target.value)} onBlur={handleCreateSubmit}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreateSubmit(); if (e.key === "Escape") { setCreating(null); setCreateName(""); } }}
            onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {expanded && (
        <div className="tree-children">
          {loading ? (
            <div className="tree-loading" style={{ paddingLeft: `${(depth + 1) * 16 + 4}px` }}>加载中...</div>
          ) : (
            children.map((child) => (
              <TreeNode key={child.path} entry={child} projectId={projectId} depth={depth + 1}
                selectedPath={selectedPath} onSelect={onSelect} onDelete={onDelete}
                onRename={onRename} onRefresh={onRefresh} />
            ))
          )}
        </div>
      )}

      {contextMenu && (
        <div className="tree-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
          {entry.isDir && (
            <>
              <button type="button" onClick={() => { setCreating("file"); setContextMenu(null); }}>新建文件</button>
              <button type="button" onClick={() => { setCreating("dir"); setContextMenu(null); }}>新建文件夹</button>
              <div className="ctx-divider" />
            </>
          )}
          <button type="button" onClick={() => { setRenaming(true); setContextMenu(null); }}>重命名</button>
          <button type="button" onClick={() => { navigator.clipboard.writeText(entry.path); setContextMenu(null); }}>复制路径</button>
          <div className="ctx-divider" />
          <button type="button" className="danger" onClick={() => { onDelete(entry.path); setContextMenu(null); }}>删除</button>
        </div>
      )}
    </div>
  );
}

interface FileBrowserProps {
  projectId: string;
  onFileSelect?: (path: string) => void;
}

export interface FileBrowserHandle {
  refresh: () => void;
}

export const FileBrowser = forwardRef<FileBrowserHandle, FileBrowserProps>(
  function FileBrowser({ projectId, onFileSelect }, ref) {
  const [rootEntries, setRootEntries] = useState<DirEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJSON<{ entries: DirEntry[] }>(
        `/projects/${projectId}/files/list?path=.`,
      );
      setRootEntries(data.entries);
    } catch { /* ignore */ }
    setLoading(false);
  }, [projectId]);

  useImperativeHandle(ref, () => ({ refresh: loadRoot }), [loadRoot]);

  useEffect(() => { loadRoot(); }, [loadRoot]);

  const handleSelect = useCallback((path: string, isDir: boolean) => {
    setSelectedPath(path);
    if (!isDir && onFileSelect) onFileSelect(path);
  }, [onFileSelect]);

  const handleDelete = useCallback(async (path: string) => {
    if (!confirm(`确定删除 ${path}？`)) return;
    try {
      await fetchJSON(`/projects/${projectId}/files?path=${encodeURIComponent(path)}`, { method: "DELETE" });
      loadRoot();
    } catch { /* ignore */ }
  }, [projectId, loadRoot]);

  const handleRename = useCallback(async (path: string, newName: string) => {
    try {
      await fetchJSON(`/projects/${projectId}/files/rename`, {
        method: "POST",
        body: JSON.stringify({ path, newName }),
      });
      loadRoot();
    } catch { /* ignore */ }
  }, [projectId, loadRoot]);

  return (
    <div className="file-browser">
      <div className="file-browser-header">
        <span className="file-browser-title">文件管理</span>
        <div className="file-browser-actions">
          <button type="button" title="刷新" onClick={loadRoot}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </button>
        </div>
      </div>
      <div className="file-browser-tree">
        {loading ? (
          <div className="tree-loading" style={{ padding: "12px" }}>加载中...</div>
        ) : (
          rootEntries.map((entry) => (
            <TreeNode key={entry.path} entry={entry} projectId={projectId} depth={0}
              selectedPath={selectedPath} onSelect={handleSelect} onDelete={handleDelete}
              onRename={handleRename} onRefresh={loadRoot} />
          ))
        )}
      </div>
    </div>
  );
});
