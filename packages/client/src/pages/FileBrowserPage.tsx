import { useCallback, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchJSON } from "../api/client";
import { FileBrowser } from "../components/FileBrowser";
import type { FileBrowserHandle } from "../components/FileBrowser";
import "./FileBrowserPage.css";

export function FileBrowserPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [highlightedHtml, setHighlightedHtml] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"preview" | "edit">("preview");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [isBinary, setIsBinary] = useState(false);
  const [renderedMarkdown, setRenderedMarkdown] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const fileBrowserRef = useRef<FileBrowserHandle>(null);

  const loadFile = useCallback(
    async (path: string) => {
      if (!projectId) return;
      setLoading(true);
      setDirty(false);
      setHighlightedHtml(null);
      setRenderedMarkdown(null);
      setIsBinary(false);
      setViewMode("preview");
      try {
        const data = await fetchJSON<{
          content?: string;
          metadata?: { isText?: boolean; mimeType?: string; size?: number };
          rawUrl?: string;
          highlightedHtml?: string;
          renderedMarkdownHtml?: string;
        }>(
          `/projects/${projectId}/files?path=${encodeURIComponent(path)}&highlight=true`,
        );

        if (data.content !== undefined) {
          setFileContent(data.content);
          setHighlightedHtml(data.highlightedHtml ?? null);
          setRenderedMarkdown(data.renderedMarkdownHtml ?? null);
        } else if (data.metadata?.isText && data.rawUrl) {
          const rawRes = await fetch(data.rawUrl, { credentials: "include" });
          if (rawRes.ok) {
            const text = await rawRes.text();
            setFileContent(text);
          } else {
            setFileContent("// Failed to load file");
          }
        } else {
          setIsBinary(true);
          setFileContent("");
        }
      } catch {
        setFileContent("// Failed to load file");
      }
      setLoading(false);
    },
    [projectId],
  );

  const handleFileSelect = useCallback(
    (path: string) => {
      setSelectedFile(path);
      void loadFile(path);
      // Close sidebar on mobile when selecting a file
      if (window.innerWidth <= 768) {
        setSidebarOpen(false);
      }
    },
    [loadFile],
  );

  const handleSave = useCallback(
    async (value: string) => {
      if (!selectedFile || !projectId) return;
      setSaving(true);
      try {
        await fetchJSON(`/projects/${projectId}/files`, {
          method: "PUT",
          body: JSON.stringify({ path: selectedFile, content: value }),
        });
        setDirty(false);
      } catch { /* ignore */ }
      setSaving(false);
    },
    [selectedFile, projectId],
  );

  const getLanguage = (path: string) => {
    const ext = path.split(".").pop()?.toLowerCase() ?? "";
    const map: Record<string, string> = {
      ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", jsx: "JavaScript",
      json: "JSON", py: "Python", rs: "Rust", go: "Go", html: "HTML",
      css: "CSS", md: "Markdown", sh: "Shell", yaml: "YAML", yml: "YAML",
      toml: "TOML", sql: "SQL", xml: "XML", java: "Java", c: "C",
      cpp: "C++", cs: "C#", rb: "Ruby", php: "PHP", swift: "Swift",
      kt: "Kotlin", dart: "Dart", lua: "Lua", r: "R",
    };
    return map[ext] ?? "Text";
  };

  if (!projectId) {
    return (
      <div className="fb-page">
        <div className="fb-empty">
          <p>未选择项目，请先前往项目页面。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fb-page">
      {/* Mobile backdrop */}
      {sidebarOpen && <div className="fb-backdrop" onClick={() => setSidebarOpen(false)} />}

      <div className={`fb-sidebar ${sidebarOpen ? "fb-sidebar-open" : ""}`}>
        <div className="fb-sidebar-topbar">
          <span className="fb-sidebar-topbar-title">文件管理</span>
          <div className="fb-sidebar-topbar-actions">
            <button className="fb-sidebar-topbar-btn" title="刷新" onClick={() => fileBrowserRef.current?.refresh()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
            <button className="fb-sidebar-topbar-btn" title="关闭" onClick={() => setSidebarOpen(false)}>✕</button>
          </div>
        </div>
        <FileBrowser ref={fileBrowserRef} projectId={projectId} onFileSelect={handleFileSelect} />
      </div>
      <div className="fb-editor">
        {selectedFile ? (
          <div className="fb-editor-container">
            <div className="fb-editor-header">
              <button
                className="fb-sidebar-toggle"
                onClick={() => setSidebarOpen(true)}
                title="打开文件树"
              >
                ☰
              </button>
              <span className="fb-editor-path">{selectedFile}</span>
              <div className="fb-editor-actions">
                {!isBinary && (
                  <>
                    <button
                      className={`fb-tab-btn ${viewMode === "preview" ? "active" : ""}`}
                      onClick={() => setViewMode("preview")}
                    >
                      预览
                    </button>
                    <button
                      className={`fb-tab-btn ${viewMode === "edit" ? "active" : ""}`}
                      onClick={() => setViewMode("edit")}
                    >
                      编辑
                    </button>
                  </>
                )}
                {saving && <span className="fb-status">保存中...</span>}
                {dirty && !saving && <span className="fb-status dirty">未保存</span>}
                {!dirty && !saving && viewMode === "edit" && (
                  <span className="fb-status saved">已保存</span>
                )}
                {viewMode === "edit" && (
                  <button
                    className="fb-save-btn"
                    onClick={() => handleSave(fileContent)}
                    disabled={!dirty || saving}
                    title="Ctrl+S"
                  >
                    保存
                  </button>
                )}
              </div>
            </div>
            <div className="fb-editor-body">
              {loading ? (
                <div className="fb-loading">加载中...</div>
              ) : isBinary ? (
                <div className="fb-empty">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <p>二进制文件 — {getLanguage(selectedFile)}</p>
                  <a
                    className="fb-download-link"
                    href={`/api/projects/${projectId}/files/raw?path=${encodeURIComponent(selectedFile)}&download=true`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    下载
                  </a>
                </div>
              ) : viewMode === "preview" && renderedMarkdown ? (
                <div className="fb-preview">
                  <div className="fb-preview-meta">
                    <span>Markdown</span>
                    <span>{fileContent.split("\n").length} 行</span>
                  </div>
                  <div
                    className="fb-markdown"
                    dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
                  />
                </div>
              ) : viewMode === "preview" && highlightedHtml ? (
                <div className="fb-preview">
                  <div className="fb-preview-meta">
                    <span>{getLanguage(selectedFile)}</span>
                    <span>{fileContent.split("\n").length} 行</span>
                  </div>
                  <div
                    className="fb-highlighted"
                    dangerouslySetInnerHTML={{ __html: highlightedHtml }}
                  />
                </div>
              ) : viewMode === "preview" ? (
                <div className="fb-preview">
                  <div className="fb-preview-meta">
                    <span>{getLanguage(selectedFile)}</span>
                    <span>{fileContent.split("\n").length} 行</span>
                  </div>
                  <pre className="fb-raw-content">{fileContent}</pre>
                </div>
              ) : (
                <textarea
                  className="fb-textarea"
                  value={fileContent}
                  onChange={(e) => {
                    setFileContent(e.target.value);
                    setDirty(true);
                  }}
                  spellCheck={false}
                />
              )}
            </div>
          </div>
        ) : (
          <div className="fb-empty">
            <button
              className="fb-sidebar-toggle fb-sidebar-toggle-empty"
              onClick={() => setSidebarOpen(true)}
              title="打开文件树"
            >
              ☰ 打开文件管理
            </button>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <p>选择文件查看</p>
          </div>
        )}
      </div>
    </div>
  );
}
