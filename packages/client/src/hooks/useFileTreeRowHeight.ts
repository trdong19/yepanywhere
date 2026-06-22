import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "fb-tree-row-height";
const DEFAULT_HEIGHT = 32;
const MIN_HEIGHT = 24;
const MAX_HEIGHT = 48;

export function useFileTreeRowHeight() {
  const [height, setHeightState] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? Number(stored) : DEFAULT_HEIGHT;
    return Number.isFinite(parsed) ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, parsed)) : DEFAULT_HEIGHT;
  });

  useEffect(() => {
    document.documentElement.style.setProperty("--fb-tree-row-height", `${height}px`);
  }, [height]);

  const setHeight = useCallback((h: number) => {
    const clamped = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, h));
    setHeightState(clamped);
    localStorage.setItem(STORAGE_KEY, String(clamped));
  }, []);

  return { height, setHeight, MIN_HEIGHT, MAX_HEIGHT, DEFAULT_HEIGHT };
}
