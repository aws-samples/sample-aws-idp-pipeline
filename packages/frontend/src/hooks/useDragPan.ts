import { useRef, useCallback } from 'react';

/**
 * Hook that enables click-and-drag panning on a scrollable container.
 * Returns a callback ref to attach to the scrollable element.
 * Uses callback ref pattern to handle conditionally rendered elements.
 */
export function useDragPan<T extends HTMLElement>() {
  const dragging = useRef(false);
  const start = useRef({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });
  const cleanupRef = useRef<(() => void) | null>(null);

  const ref = useCallback((node: T | null) => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }

    if (!node) return;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (
        node.scrollWidth <= node.clientWidth &&
        node.scrollHeight <= node.clientHeight
      )
        return;

      dragging.current = true;
      start.current = {
        x: e.clientX,
        y: e.clientY,
        scrollLeft: node.scrollLeft,
        scrollTop: node.scrollTop,
      };
      node.style.cursor = 'grabbing';
      node.style.userSelect = 'none';
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      node.scrollLeft = start.current.scrollLeft - dx;
      node.scrollTop = start.current.scrollTop - dy;
    };

    const onMouseUp = () => {
      if (!dragging.current) return;
      dragging.current = false;
      node.style.cursor = '';
      node.style.userSelect = '';
    };

    node.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    cleanupRef.current = () => {
      node.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return ref;
}
