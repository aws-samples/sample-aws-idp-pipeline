import { useState, useCallback, useEffect, useRef, useMemo } from 'react';

const PANEL_STORAGE_KEY = 'idp-panel-sizes-v2';

export function usePanelLayout() {
  const [sidePanelCollapsed, setSidePanelCollapsed] = useState(false);
  const sidePanelSizeBeforeCollapse = useRef<number[]>([70, 30]);

  const savedPanelSizes = useMemo(() => {
    try {
      const raw = localStorage.getItem(PANEL_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === 2) {
          return parsed as number[];
        }
      }
    } catch {
      // ignore
    }
    return [70, 30];
  }, []);

  useEffect(() => {
    sidePanelSizeBeforeCollapse.current = savedPanelSizes;
  }, [savedPanelSizes]);

  const handlePanelResizeEnd = useCallback(
    (details: { size: number[] }) => {
      try {
        localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(details.size));
        if (!sidePanelCollapsed && details.size.length === 2) {
          sidePanelSizeBeforeCollapse.current = details.size;
        }
      } catch {
        // ignore
      }
    },
    [sidePanelCollapsed],
  );

  const expandSidePanel = useCallback(() => {
    setSidePanelCollapsed(false);
    localStorage.setItem(
      PANEL_STORAGE_KEY,
      JSON.stringify(sidePanelSizeBeforeCollapse.current),
    );
  }, []);

  return {
    sidePanelCollapsed,
    setSidePanelCollapsed,
    savedPanelSizes,
    sidePanelSizeBeforeCollapse,
    handlePanelResizeEnd,
    expandSidePanel,
  };
}
