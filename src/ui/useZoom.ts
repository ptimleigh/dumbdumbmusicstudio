import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Time zoom for an editor. Zoom 1 is "the whole song fits the window"; larger values magnify it.
 * Zooming keeps the point under the cursor (or the middle of the view) where it is.
 * Also handles Ctrl+scroll, two-finger pinch, the + / - / 0 keys, and following the playhead.
 */
export function useTimeZoom(o: {
  scrollRef: RefObject<HTMLDivElement | null>;
  areaWidth: number;      // visible width of the scroll area
  total: number;          // song length in beats
  leftW: number;          // width of the sticky column on the left (piano keys or drum names)
  minBeat: number;        // narrowest a beat may get, in px
  maxBeat: number;        // widest a beat may get, in px
  playhead: number;       // in beats, 0 when stopped
  follow: boolean;
  focusBeat?: number;     // the start marker: scrolled back into view when playback stops
  onHeightZoom?: (factor: number) => void; // Ctrl+Shift+scroll
}) {
  const { scrollRef, areaWidth, total, leftW, minBeat, maxBeat } = o;
  const [zoom, setZoom] = useState(1);
  const fit = areaWidth > 0 ? (areaWidth - leftW - 2) / total : 48;
  const base = Math.max(minBeat, fit);
  const maxZoom = Math.max(1, maxBeat / base);
  const beatW = clamp(base * zoom, minBeat, maxBeat);

  // when zoom changes, restore the beat that was under the anchor point
  const anchor = useRef<{ beat: number; x: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.current, el = scrollRef.current;
    if (a && el) { el.scrollLeft = Math.max(0, a.beat * beatW + leftW - a.x); anchor.current = null; }
  }, [beatW, leftW, scrollRef]);

  // keep the latest values reachable from event listeners without re-attaching them
  const live = useRef({ zoom, maxZoom, beatW });
  live.current = { zoom, maxZoom, beatW };

  const zoomTo = useCallback((next: number, clientX?: number) => {
    const el = scrollRef.current;
    const { maxZoom: mz, beatW: bw } = live.current;
    const z = clamp(next, 1, mz);
    if (el) {
      const r = el.getBoundingClientRect();
      const x = clientX !== undefined ? clientX - r.left : (r.width + leftW) / 2;
      anchor.current = { beat: (el.scrollLeft + x - leftW) / bw, x };
    }
    setZoom(z);
  }, [scrollRef, leftW]);

  const zoomBy = useCallback((factor: number, clientX?: number) => zoomTo(live.current.zoom * factor, clientX), [zoomTo]);
  const reset = useCallback(() => { anchor.current = { beat: 0, x: leftW }; setZoom(1); }, [leftW]);

  /** Magnify so that a time span (in beats) fills the view, starting a little before it. */
  const zoomToSpan = useCallback((start: number, end: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const span = Math.max(end - start, 0.5) * 1.3;
    const target = (el.clientWidth - leftW - 24) / span;
    const z = clamp(target / base, 1, live.current.maxZoom);
    anchor.current = { beat: Math.max(0, start - span * 0.08), x: leftW };
    setZoom(z);
  }, [scrollRef, leftW, base]);

  // Ctrl+scroll (and trackpad pinch) and two-finger pinch
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
      if (e.shiftKey && o.onHeightZoom) o.onHeightZoom(factor); else zoomBy(factor, e.clientX);
    };
    let pinch: { d0: number; z0: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent) => { if (e.touches.length === 2) pinch = { d0: dist(e.touches), z0: live.current.zoom }; };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch) return;
      e.preventDefault();
      zoomTo(pinch.z0 * (dist(e.touches) / pinch.d0), (e.touches[0].clientX + e.touches[1].clientX) / 2);
    };
    const onTouchEnd = (e: TouchEvent) => { if (e.touches.length < 2) pinch = null; };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  });

  // + / - zoom in and out, 0 fits the song
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomBy(1.5); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / 1.5); }
      else if (e.key === '0') { e.preventDefault(); reset(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoomBy, reset]);

  // while playing, keep the playhead in view
  useEffect(() => {
    const el = scrollRef.current;
    if (!o.follow || o.playhead <= 0 || !el) return;
    const x = o.playhead * beatW;
    const left = el.scrollLeft, right = el.scrollLeft + el.clientWidth - leftW;
    if (x > right - 48 || x < left) el.scrollLeft = Math.max(0, x - 80);
  }, [o.playhead, o.follow, beatW, leftW, scrollRef]);

  // when playback stops, bring the start marker back into view
  const wasPlaying = useRef(false);
  useEffect(() => {
    const playing = o.playhead > 0;
    const el = scrollRef.current;
    if (wasPlaying.current && !playing && o.follow && el && o.focusBeat !== undefined) {
      const x = o.focusBeat * beatW;
      if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - leftW - 24) el.scrollLeft = Math.max(0, x - 80);
    }
    wasPlaying.current = playing;
  }, [o.playhead > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  return { beatW, zoom, maxZoom, zoomTo, zoomBy, reset, zoomToSpan, atFit: zoom <= 1.001 };
}
