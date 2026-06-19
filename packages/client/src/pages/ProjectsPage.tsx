import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { fetchJSON } from "../api/client";
import { PageHeader } from "../components/PageHeader";
import { ProjectCard } from "../components/ProjectCard";
import { useInboxContext } from "../contexts/InboxContext";
import { useProjects } from "../hooks/useProjects";
import { useRemoteBasePath } from "../hooks/useRemoteBasePath";
import { useI18n } from "../i18n";
import { MainContent, useNavigationLayout } from "../layouts";
import type { Project } from "../types";

interface DirEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

export function ProjectsPage() {
  const { t } = useI18n();
  const { projects, loading, error, refetch } = useProjects();
  const { needsAttention, active } = useInboxContext();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProjectPath, setNewProjectPath] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(
    null,
  );
  const navigate = useNavigate();
  const basePath = useRemoteBasePath();

  // Directory autocomplete state
  const [dirSuggestions, setDirSuggestions] = useState<DirEntry[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const fetchDirSuggestions = useCallback(async (path: string) => {
    const queryPath = path.trim() || "/";
    setLoadingSuggestions(true);
    try {
      const data = await fetchJSON<{ path: string; entries: DirEntry[] }>(
        `/server/browse-dirs?path=${encodeURIComponent(queryPath)}`,
      );
      setDirSuggestions(data.entries);
      setShowSuggestions(data.entries.length > 0);
      setSelectedSuggestion(-1);
    } catch {
      setDirSuggestions([]);
      setShowSuggestions(false);
    }
    setLoadingSuggestions(false);
  }, []);

  const handlePathChange = useCallback(
    (value: string) => {
      setNewProjectPath(value);
      setSelectedSuggestion(-1);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        // Auto-complete: if empty, list root; if ends with /, list that directory
        // Otherwise list the parent directory
        if (!value.trim()) {
          void fetchDirSuggestions("/");
          return;
        }
        const lastSlash = value.lastIndexOf("/");
        const dirToList = lastSlash > 0 ? value.slice(0, lastSlash) || "/" : "/";
        void fetchDirSuggestions(dirToList);
      }, 300);
    },
    [fetchDirSuggestions],
  );

  const selectSuggestion = useCallback(
    (entry: DirEntry) => {
      setNewProjectPath(`${entry.path}/`);
      setShowSuggestions(false);
      setSelectedSuggestion(-1);
      // Immediately show subdirectories
      void fetchDirSuggestions(entry.path);
    },
    [fetchDirSuggestions],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showSuggestions || dirSuggestions.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedSuggestion((prev) =>
          prev < dirSuggestions.length - 1 ? prev + 1 : 0,
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedSuggestion((prev) =>
          prev > 0 ? prev - 1 : dirSuggestions.length - 1,
        );
      } else if (e.key === "Tab" || e.key === "Enter") {
        if (selectedSuggestion >= 0 && selectedSuggestion < dirSuggestions.length) {
          e.preventDefault();
          selectSuggestion(dirSuggestions[selectedSuggestion]!);
        }
      } else if (e.key === "Escape") {
        setShowSuggestions(false);
      }
    },
    [showSuggestions, dirSuggestions, selectedSuggestion, selectSuggestion],
  );

  // Close suggestions on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const { openSidebar, isWideScreen, toggleSidebar, isSidebarCollapsed } =
    useNavigationLayout();

  // Count needs-attention items per project (client-side filter - free)
  const attentionByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of needsAttention) {
      const current = counts.get(item.projectId) ?? 0;
      counts.set(item.projectId, current + 1);
    }
    return counts;
  }, [needsAttention]);

  // Count actively-thinking sessions per project (from inbox "active" tier)
  const thinkingByProject = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of active) {
      const current = counts.get(item.projectId) ?? 0;
      counts.set(item.projectId, current + 1);
    }
    return counts;
  }, [active]);

  // Sort projects: those needing attention first, then by recency
  const sortedProjects = useMemo(() => {
    return [...projects].sort((a, b) => {
      const aNeeds = attentionByProject.get(a.id) ?? 0;
      const bNeeds = attentionByProject.get(b.id) ?? 0;

      // Projects needing attention come first
      if (aNeeds > 0 && bNeeds === 0) return -1;
      if (bNeeds > 0 && aNeeds === 0) return 1;

      // Then sort by last activity (most recent first)
      const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
      const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
      return bTime - aTime;
    });
  }, [projects, attentionByProject]);

  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectPath.trim()) return;

    setAdding(true);
    setAddError(null);

    try {
      const { project } = await api.addProject(newProjectPath.trim());
      await refetch();
      setNewProjectPath("");
      setShowAddForm(false);
      // Navigate to sessions filtered by the new project
      navigate(`${basePath}/sessions?project=${project.id}`);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : t("projectsAddFailed"));
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteProject = async (project: Project) => {
    if (!confirm(t("projectsDeleteConfirm", { name: project.name }))) {
      return;
    }

    setDeletingProjectId(project.id);
    setDeleteError(null);

    try {
      await api.deleteProject(project.id);
      await refetch();
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : t("projectsDeleteFailed"),
      );
    } finally {
      setDeletingProjectId(null);
    }
  };

  if (loading) return <div className="loading">{t("projectsLoading")}</div>;
  if (error) {
    return (
      <div className="error">
        {t("projectsErrorPrefix")} {error.message}
      </div>
    );
  }

  const isEmpty = projects.length === 0;

  return (
    <MainContent isWideScreen={isWideScreen}>
      <PageHeader
        title={t("pageTitleProjects")}
        onOpenSidebar={openSidebar}
        onToggleSidebar={toggleSidebar}
        isWideScreen={isWideScreen}
        isSidebarCollapsed={isSidebarCollapsed}
      />

      <main className="page-scroll-container">
        <div className="page-content-inner">
          {/* Toolbar with Add Project button */}
          <div className="inbox-toolbar">
            {!showAddForm ? (
              <button
                type="button"
                className="inbox-refresh-button"
                onClick={() => {
                  setShowAddForm(true);
                  void fetchDirSuggestions("/");
                }}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                {t("projectsAdd")}
              </button>
            ) : (
              <form onSubmit={handleAddProject} className="add-project-form" style={{ position: "relative" }}>
                <input
                  ref={inputRef}
                  type="text"
                  value={newProjectPath}
                  onChange={(e) => handlePathChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onFocus={() => {
                    if (dirSuggestions.length > 0) setShowSuggestions(true);
                    else void fetchDirSuggestions(newProjectPath || "/");
                  }}
                  placeholder={t("projectsAddPlaceholder")}
                  disabled={adding}
                  autoComplete="off"
                />
                {showSuggestions && dirSuggestions.length > 0 && (
                  <div ref={suggestionsRef} className="dir-suggestions-dropdown">
                    {dirSuggestions.map((entry, i) => (
                      <div
                        key={entry.path}
                        role="option"
                        aria-selected={i === selectedSuggestion}
                        tabIndex={-1}
                        className={`dir-suggestion-item ${i === selectedSuggestion ? "selected" : ""}`}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          selectSuggestion(entry);
                        }}
                        onMouseEnter={() => setSelectedSuggestion(i)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                        <span className="dir-suggestion-name">{entry.name}</span>
                        {entry.isGitRepo && (
                          <span className="dir-suggestion-badge">git</span>
                        )}
                        <span className="dir-suggestion-path">{entry.path}</span>
                      </div>
                    ))}
                    {loadingSuggestions && (
                      <div className="dir-suggestion-loading">Loading...</div>
                    )}
                  </div>
                )}
                <div className="add-project-actions">
                  <button
                    type="submit"
                    disabled={adding || !newProjectPath.trim()}
                  >
                    {adding ? t("projectsAdding") : t("projectsAddConfirm")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddForm(false);
                      setNewProjectPath("");
                      setAddError(null);
                    }}
                    disabled={adding}
                  >
                    {t("projectsCancel")}
                  </button>
                </div>
                {addError && (
                  <div className="add-project-error">{addError}</div>
                )}
              </form>
            )}
          </div>
          {deleteError && (
            <div className="add-project-error">{deleteError}</div>
          )}

          {isEmpty ? (
            <div className="inbox-empty">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              <h3>{t("projectsEmptyTitle")}</h3>
              <p>{t("projectsEmptyDescription")}</p>
            </div>
          ) : (
            <ul className="project-list-cards">
              {sortedProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  needsAttentionCount={attentionByProject.get(project.id) ?? 0}
                  thinkingCount={thinkingByProject.get(project.id) ?? 0}
                  basePath={basePath}
                  onDeleteProject={handleDeleteProject}
                  isDeleting={deletingProjectId === project.id}
                />
              ))}
            </ul>
          )}
        </div>
      </main>
    </MainContent>
  );
}
