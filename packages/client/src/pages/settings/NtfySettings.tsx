import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { useServerSettings } from "../../hooks/useServerSettings";
import { useI18n } from "../../i18n";
import { useSettingsUndoBaseline } from "./SettingsUndoContext";

const MAX_URL_LENGTH = 2000;
const MAX_TOPIC_LENGTH = 200;

export function NtfySettings() {
  const { t } = useI18n();
  const { settings, isLoading, error, updateSettings } = useServerSettings();
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState("");
  const [topic, setTopic] = useState("");
  const [sessionLink, setSessionLink] = useState(true);
  const [srvUrl, setSrvUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [hasDraftEdits, setHasDraftEdits] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<"success" | "error" | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [formSynced, setFormSynced] = useState(false);

  const serverEnabled = settings?.ntfyEnabled ?? false;
  const serverNtfyUrl = settings?.ntfyUrl ?? "";
  const serverTopic = settings?.ntfyTopic ?? "";
  const serverSessionLink = settings?.ntfySessionLink ?? true;
  const serverSrvUrl = settings?.serverUrl ?? "";
  const normalizedUrl = url.trim();
  const normalizedTopic = topic.trim();
  const normalizedSrvUrl = srvUrl.trim();
  const hasChanges =
    enabled !== serverEnabled ||
    normalizedUrl !== serverNtfyUrl ||
    normalizedTopic !== serverTopic ||
    sessionLink !== serverSessionLink ||
    normalizedSrvUrl !== serverSrvUrl;

  useEffect(() => {
    if (!settings) return;
    if (hasDraftEdits || isSaving) return;
    setEnabled(serverEnabled);
    setUrl(serverNtfyUrl);
    setTopic(serverTopic);
    setSessionLink(serverSessionLink);
    setSrvUrl(serverSrvUrl);
    setFormSynced(true);
  }, [hasDraftEdits, isSaving, serverEnabled, serverNtfyUrl, serverTopic, serverSessionLink, serverSrvUrl, settings]);

  const undoState = useMemo(
    () => (formSynced ? { enabled, url, topic, sessionLink, srvUrl } : null),
    [formSynced, enabled, url, topic, sessionLink, srvUrl],
  );
  const restoreUndoState = useCallback(
    (snapshot: NonNullable<typeof undoState>) => {
      setEnabled(snapshot.enabled);
      setUrl(snapshot.url);
      setTopic(snapshot.topic);
      setSessionLink(snapshot.sessionLink);
      setSrvUrl(snapshot.srvUrl);
      setSaveError(null);
      setHasDraftEdits(true);
    },
    [],
  );
  useSettingsUndoBaseline(undoState, restoreUndoState);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await updateSettings({
        ntfyEnabled: enabled,
        ntfyUrl: normalizedUrl || undefined,
        ntfyTopic: normalizedTopic || undefined,
        ntfySessionLink: sessionLink,
        serverUrl: normalizedSrvUrl || undefined,
      });
      setHasDraftEdits(false);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : t("ntfySaveFailed"),
      );
    } finally {
      setIsSaving(false);
    }
  }, [enabled, normalizedTopic, normalizedUrl, sessionLink, normalizedSrvUrl, t, updateSettings]);

  const handleTest = useCallback(async () => {
    if (!enabled) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      await api.testNtfyNotification();
      setTestResult("success");
    } catch {
      setTestResult("error");
    } finally {
      setIsTesting(false);
    }
  }, [enabled]);

  if (isLoading) {
    return (
      <section className="settings-section">
        <h2>{t("ntfyTitle")}</h2>
        <p className="settings-section-description">{t("ntfyLoading")}</p>
      </section>
    );
  }

  return (
    <section className="settings-section">
      <h2>{t("ntfyTitle")}</h2>
      <p className="settings-section-description">{t("ntfyDescription")}</p>

      <div className="settings-group">
        <label className="settings-item">
          <div className="settings-item-info">
            <strong>{t("ntfyEnabledTitle")}</strong>
          </div>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setHasDraftEdits(true);
              setSaveError(null);
            }}
          />
        </label>

        <div
          className="settings-item"
          style={{ flexDirection: "column", alignItems: "stretch" }}
        >
          <div className="settings-item-info">
            <strong>{t("ntfyUrlTitle")}</strong>
            <p>{t("ntfyUrlHint")}</p>
          </div>
          <input
            aria-label={t("ntfyUrlTitle")}
            autoComplete="off"
            type="url"
            className="settings-input"
            id="ntfy-url"
            name="yep-ntfy-url"
            value={url}
            onChange={(e) => {
              const value = e.target.value.slice(0, MAX_URL_LENGTH);
              setUrl(value);
              setHasDraftEdits(true);
              setSaveError(null);
            }}
            placeholder="https://ntfy.kdns.fr"
            spellCheck={false}
          />
        </div>

        <div
          className="settings-item"
          style={{ flexDirection: "column", alignItems: "stretch" }}
        >
          <div className="settings-item-info">
            <strong>{t("ntfyTopicTitle")}</strong>
            <p>{t("ntfyTopicHint")}</p>
          </div>
          <input
            aria-label={t("ntfyTopicTitle")}
            autoComplete="off"
            type="text"
            className="settings-input"
            id="ntfy-topic"
            name="yep-ntfy-topic"
            value={topic}
            onChange={(e) => {
              const value = e.target.value.slice(0, MAX_TOPIC_LENGTH);
              setTopic(value);
              setHasDraftEdits(true);
              setSaveError(null);
            }}
            placeholder="claude"
            spellCheck={false}
          />
        </div>

        <label className="settings-item">
          <div className="settings-item-info">
            <strong>{t("ntfySessionLinkTitle")}</strong>
            <p>{t("ntfySessionLinkHint")}</p>
          </div>
          <input
            type="checkbox"
            checked={sessionLink}
            onChange={(e) => {
              setSessionLink(e.target.checked);
              setHasDraftEdits(true);
              setSaveError(null);
            }}
          />
        </label>

        <div
          className="settings-item"
          style={{ flexDirection: "column", alignItems: "stretch" }}
        >
          <div className="settings-item-info">
            <strong>{t("ntfyServerUrlTitle")}</strong>
            <p>{t("ntfyServerUrlHint")}</p>
          </div>
          <input
            aria-label={t("ntfyServerUrlTitle")}
            autoComplete="off"
            type="url"
            className="settings-input"
            id="ntfy-server-url"
            name="yep-ntfy-server-url"
            value={srvUrl}
            onChange={(e) => {
              const value = e.target.value.slice(0, MAX_URL_LENGTH);
              setSrvUrl(value);
              setHasDraftEdits(true);
              setSaveError(null);
            }}
            placeholder="https://192.168.1.100:3500"
            spellCheck={false}
          />
        </div>

        <div
          className="settings-item"
          style={{ justifyContent: "flex-end", gap: "var(--space-2)" }}
        >
          {enabled && (
            <button
              type="button"
              className="settings-button"
              disabled={hasChanges || isSaving || isTesting}
              onClick={handleTest}
            >
              {isTesting ? t("ntfyTesting") : t("ntfyTest")}
            </button>
          )}
          <button
            type="button"
            className="settings-button"
            disabled={!hasChanges || isSaving}
            onClick={handleSave}
          >
            {isSaving ? t("providersSaving") : t("providersSave")}
          </button>
        </div>

        {testResult === "success" && (
          <p className="settings-success">{t("ntfyTestSuccess")}</p>
        )}
        {testResult === "error" && (
          <p className="settings-warning">{t("ntfyTestFailed")}</p>
        )}

        {(saveError || error) && (
          <p className="settings-warning">{saveError || error}</p>
        )}
      </div>
    </section>
  );
}
