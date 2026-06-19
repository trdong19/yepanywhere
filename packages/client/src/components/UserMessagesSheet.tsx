import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";

export interface UserMessageItem {
  id: string;
  preview: string;
  timestampMs: number;
  elementIndex: number;
}

interface UserMessagesSheetProps {
  messages: UserMessageItem[];
  onJumpToMessage: (messageId: string) => void;
  isOpen: boolean;
  onClose: () => void;
  hasOlderMessages?: boolean;
  loadingOlder?: boolean;
  onLoadOlderMessages?: () => void;
}

function formatTime(timestampMs: number): string {
  const date = new Date(timestampMs);
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function UserMessagesSheetComponent({
  messages,
  onJumpToMessage,
  isOpen,
  onClose,
  hasOlderMessages,
  loadingOlder,
  onLoadOlderMessages,
}: UserMessagesSheetProps) {
  const { t } = useI18n();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchCurrent, setTouchCurrent] = useState<number | null>(null);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");

  // 根据排序顺序显示消息
  const sortedMessages = useMemo(() => {
    if (sortOrder === "newest") {
      return [...messages].sort((a, b) => b.timestampMs - a.timestampMs);
    }
    return [...messages].sort((a, b) => a.timestampMs - b.timestampMs);
  }, [messages, sortOrder]);

  const toggleSortOrder = useCallback(() => {
    setSortOrder((prev) => (prev === "newest" ? "oldest" : "newest"));
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      setTouchStart(touch.clientY);
      setTouchCurrent(touch.clientY);
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (touch && touchStart !== null) {
        setTouchCurrent(touch.clientY);
      }
    },
    [touchStart],
  );

  const handleTouchEnd = useCallback(() => {
    if (touchStart !== null && touchCurrent !== null) {
      const diff = touchCurrent - touchStart;
      // 向下拖拽超过 100px 关闭
      if (diff > 100) {
        onClose();
      }
    }
    setTouchStart(null);
    setTouchCurrent(null);
  }, [touchStart, touchCurrent, onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  const handleMessageClick = useCallback(
    (messageId: string) => {
      onJumpToMessage(messageId);
      onClose();
    },
    [onJumpToMessage, onClose],
  );

  // ESC 键关闭
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // 计算拖拽偏移量
  const dragOffset =
    touchStart !== null && touchCurrent !== null
      ? Math.max(0, touchCurrent - touchStart)
      : 0;

  return (
    <div className="user-messages-backdrop" role="button" tabIndex={-1} onClick={handleBackdropClick} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div
        ref={sheetRef}
        className="user-messages-sheet"
        style={{ transform: `translateY(${dragOffset}px)` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="user-messages-header">
          <div className="user-messages-handle" />
          <div className="user-messages-header-content">
            <h3 className="user-messages-title">
              {t("userMessagesTitle")}
            </h3>
            <div className="user-messages-header-actions">
              <button
                type="button"
                className="user-messages-sort-button"
                onClick={toggleSortOrder}
                title={sortOrder === "newest" ? t("userMessagesSortOldest") : t("userMessagesSortNewest")}
              >
                {sortOrder === "newest" ? "↑" : "↓"}
              </button>
              <span className="user-messages-count">
                {messages.length} {t("userMessagesCount")}
              </span>
            </div>
          </div>
        </div>

        <div className="user-messages-list">
          {sortedMessages.length === 0 ? (
            <div className="user-messages-empty">
              {t("userMessagesEmpty")}
            </div>
          ) : (
            sortedMessages.map((msg) => (
              <button
                key={msg.id}
                type="button"
                className="user-message-item"
                onClick={() => handleMessageClick(msg.id)}
              >
                <span className="user-message-time">
                  {formatTime(msg.timestampMs)}
                </span>
                <span className="user-message-preview">{msg.preview}</span>
              </button>
            ))
          )}
          {hasOlderMessages && onLoadOlderMessages && (
            <button
              type="button"
              className="user-messages-load-older"
              onClick={onLoadOlderMessages}
              disabled={loadingOlder}
            >
              {loadingOlder ? (
                <>
                  <span className="spinning">&#x21BB;</span>{" "}
                  {t("userMessagesLoadingOlder")}
                </>
              ) : (
                t("userMessagesLoadOlder")
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export const UserMessagesSheet = memo(UserMessagesSheetComponent);

interface UserMessagesFABProps {
  messages: UserMessageItem[];
  onJumpToMessage: (messageId: string) => void;
  visible?: boolean;
  hasOlderMessages?: boolean;
  loadingOlder?: boolean;
  onLoadOlderMessages?: () => void;
  totalUserTurns?: number;
}

function UserMessagesFABComponent({
  messages,
  onJumpToMessage,
  visible = true,
  hasOlderMessages,
  loadingOlder,
  onLoadOlderMessages,
  totalUserTurns: _totalUserTurns,
}: UserMessagesFABProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);

  const handleOpen = useCallback(() => setIsOpen(true), []);
  const handleClose = useCallback(() => setIsOpen(false), []);

  if (!visible || messages.length === 0) return null;

  return (
    <>
      <button
        type="button"
        className="user-messages-fab"
        onClick={handleOpen}
        aria-label={t("userMessagesButtonLabel")}
        title={t("userMessagesButtonLabel")}
      >
        {messages.length}
      </button>
      <UserMessagesSheet
        messages={messages}
        onJumpToMessage={onJumpToMessage}
        isOpen={isOpen}
        onClose={handleClose}
        hasOlderMessages={hasOlderMessages}
        loadingOlder={loadingOlder}
        onLoadOlderMessages={onLoadOlderMessages}
      />
    </>
  );
}

export const UserMessagesFAB = memo(UserMessagesFABComponent);
