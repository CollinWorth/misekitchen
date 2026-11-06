import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Renders into document.body so the panel can't be clipped by a scrollable
// (overflow-x: auto) pill row — the row's implicit overflow-y: auto would
// otherwise crop anything that pops out below it.
export default function FilterDropdown({ open, anchorRef, onClose, className = '', children }) {
  const panelRef = useRef(null);
  const [coords, setCoords] = useState(null);

  useLayoutEffect(() => {
    if (!open) { setCoords(null); return; }
    const update = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      const M = 8, GAP = 6;
      const panel = panelRef.current;
      const w = panel ? panel.offsetWidth : 0;
      const h = panel ? panel.scrollHeight : 0;
      const left = Math.max(M, Math.min(rect.left, window.innerWidth - w - M));
      const below = rect.bottom + GAP;
      const spaceBelow = window.innerHeight - below - M;
      const spaceAbove = rect.top - GAP - M;
      let top = below, maxHeight;
      if (h > spaceBelow) {
        if (h <= spaceAbove) top = rect.top - GAP - h;
        else if (spaceAbove > spaceBelow) { maxHeight = spaceAbove; top = rect.top - GAP - maxHeight; }
        else maxHeight = spaceBelow;
      }
      setCoords(c => (c && c.top === top && c.left === left && c.maxHeight === maxHeight ? c : { top, left, maxHeight }));
    };
    update();
    const ro = typeof ResizeObserver !== 'undefined' && panelRef.current ? new ResizeObserver(update) : null;
    if (ro) ro.observe(panelRef.current);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open, anchorRef, !!coords]);

  useEffect(() => {
    if (!open) return;
    const handler = e => {
      if (anchorRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      onClose();
    };
    const onKeyDown = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, anchorRef, onClose]);

  if (!open || !coords) return null;

  return createPortal(
    <div ref={panelRef} className={className} style={{ position: 'fixed', top: coords.top, left: coords.left, zIndex: 1000, ...(coords.maxHeight ? { maxHeight: coords.maxHeight, overflowY: 'auto' } : {}) }}>
      {children}
    </div>,
    document.body
  );
}
