import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Note, Project, Track } from '../music/types';
import { DURATION_LABELS, isBlackKey, isInScale, noteName, snapToScale } from '../music/theory';
import { clampSemitones, slideToNext, type NoteBend } from '../music/bend';
import { makeClip, moveNotes, notesInRect, pasteClip, resizeNotes, selectionBounds, stepInScale, type Clip } from '../music/edit';
import { chordScaleOf, findClashes, lastChord, ROMAN, suggestNext, triadPitches } from '../music/harmony';
import { engine } from '../audio/engine';
import { uid } from '../music/project';
import { Icon, Popover, Segmented, Slider, Switch, useElementWidth } from './kit';
import { useTimeZoom } from './useZoom';

const LOW = 48, HIGH = 84; // C3..C6
const KEYS_W = 52, RULER_H = 28, HANDLE = 7;
const DEFAULT_ROW_H = 20, MIN_ROW_H = 14, MAX_ROW_H = 44;
const MIN_BEAT = 14, MAX_BEAT = 640;
const SNAPS: { value: number; label: string; title: string }[] = [
  { value: 0.5, label: '½', title: 'Snap to half beats' },
  { value: 0.25, label: '¼', title: 'Snap to quarter beats' },
  { value: 0.125, label: '⅛', title: 'Snap to eighths of a beat' },
  { value: 0.0625, label: '1⁄16', title: 'Snap to sixteenths of a beat (very fine)' },
];
/** The finest snap that is still wide enough on screen to aim at. */
const autoSnap = (beatW: number) => (beatW >= 176 ? 0.0625 : beatW >= 88 ? 0.125 : 0.25);
const LENGTH_HINT: Record<string, string> = { Tiny: '¼ beat', Short: '½ beat', Medium: '1 beat', Long: '2 beats', 'Very long': '4 beats' };

type DragMode = 'move' | 'left' | 'right';
interface Drag {
  gid: string; id: string; mode: DragMode; x0: number; y0: number; base: Note[]; ids: Set<string>;
  lastPitch: number; moved: boolean; collapseOnClick: boolean;
}
interface Marquee { x0: number; y0: number; x1: number; y1: number; additive: boolean; before: ReadonlySet<string> }

export function PianoRoll({ project, track, playhead, onNotes }: {
  project: Project; track: Track; playhead: number; onNotes: (n: Note[], key?: string) => void;
}) {
  const [duration, setDuration] = useState(1);
  const [lock, setLock] = useState(true);
  const [showGhosts, setShowGhosts] = useState(true);
  const [showClashes, setShowClashes] = useState(true);
  const [rowH, setRowH] = useState(DEFAULT_ROW_H);
  const [snapPref, setSnapPref] = useState<'auto' | number>('auto');
  const [follow, setFollow] = useState(true);
  const total = project.bars * project.beatsPerBar;
  const drag = useRef<Drag | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [tool, setTool] = useState<'draw' | 'select'>('draw');
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const clipboard = useRef<{ clip: Clip; next: number } | null>(null);
  const gridPointer = useRef<string>('mouse');
  const lastPointer = useRef<string>('mouse'); // double-click and right-click only remove notes with a mouse, never by accident on touch
  const [scrollRef, areaWidth] = useElementWidth<HTMLDivElement>();

  // the song always fits the width of the screen; zooming magnifies it
  const tz = useTimeZoom({
    scrollRef, areaWidth, total, leftW: KEYS_W, minBeat: MIN_BEAT, maxBeat: MAX_BEAT, playhead, follow,
    onHeightZoom: factor => changeRowH(rowHRef.current * factor),
  });
  const BEAT_W = tz.beatW;
  const ROW_H = rowH;
  const GRID = snapPref === 'auto' ? autoSnap(BEAT_W) : snapPref;
  const rowHRef = useRef(rowH);
  rowHRef.current = rowH;

  // changing the note height keeps the middle of the view where it is
  const vAnchor = useRef<{ pitch: number; y: number } | null>(null);
  function changeRowH(next: number) {
    const el = scrollRef.current;
    const h = Math.round(Math.min(MAX_ROW_H, Math.max(MIN_ROW_H, next)));
    if (el && h !== rowHRef.current) {
      const y = (el.clientHeight + RULER_H) / 2;
      vAnchor.current = { pitch: HIGH - (el.scrollTop + y - RULER_H) / rowHRef.current, y };
    }
    setRowH(h);
  }
  useLayoutEffect(() => {
    const a = vAnchor.current, el = scrollRef.current;
    if (a && el) { el.scrollTop = Math.max(0, (HIGH - a.pitch) * rowH + RULER_H - a.y); vAnchor.current = null; }
  }, [rowH, scrollRef]);

  // only notes that still exist count as selected (after undo, delete, or switching tracks)
  const selIds = new Set(track.notes.filter(n => selected.has(n.id)).map(n => n.id));
  const selNotes = track.notes.filter(n => selIds.has(n.id));
  const selectedNote = selNotes.length === 1 ? selNotes[0] : null; // slide controls work on one note at a time
  const rows: number[] = [];
  for (let p = HIGH; p >= LOW; p--) rows.push(p);

  const others = project.tracks.filter(t => t.id !== track.id && t.role !== 'drums');
  const clashes = showClashes ? findClashes(track, others) : new Map();

  // what chord just played here (or on the chords track), and what usually sounds good next
  const roman = ROMAN[chordScaleOf(project.scaleName)];
  const chordsTrack = others.find(t => t.role === 'chords');
  const prevChord = lastChord(track.notes, project.beatsPerBar, project.key, project.scaleName)
    ?? (chordsTrack ? lastChord(chordsTrack.notes, project.beatsPerBar, project.key, project.scaleName) : null);
  const suggestions = suggestNext(prevChord, project.scaleName);
  const suggested = new Map(suggestions.map(x => [x.degree, x.reason]));

  // start with the notes (or the middle of the keyboard) in view
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const mid = track.notes.length ? track.notes.reduce((s, n) => s + n.pitch, 0) / track.notes.length : 72;
    el.scrollTop = Math.max(0, (HIGH - mid) * ROW_H + RULER_H - el.clientHeight / 2);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id, project.tracks.length === 0]);

  const bounds = { total, low: LOW, high: HIGH };
  const shiftInKey = lock ? (p: number, r: number) => stepInScale(p, r, project.key, project.scaleName) : undefined;
  const pitchAt = (y: number) => Math.min(HIGH, Math.max(LOW, HIGH - Math.floor(y / ROW_H)));
  const flash = (text: string) => { setMessage(text); window.setTimeout(() => setMessage(m => (m === text ? null : m)), 4500); };

  function addNoteAt(x: number, y: number) {
    let pitch = pitchAt(y);
    const start = Math.floor(x / BEAT_W / GRID) * GRID;
    if (start + GRID > total) return;
    setSelected(new Set());
    if (lock) pitch = snapToScale(pitch, project.key, project.scaleName);
    onNotes([...track.notes, { id: uid('n'), pitch, start, duration: Math.min(duration, total - start) }]);
    engine.preview(track, pitch);
  }

  const gridPos = (e: { clientX: number; clientY: number; currentTarget: Element }) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function gridDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    gridPointer.current = e.pointerType;
    const { x, y } = gridPos(e);
    if (tool === 'select' || e.shiftKey || e.ctrlKey || e.metaKey) {
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      e.currentTarget.setPointerCapture(e.pointerId);
      setMarquee({ x0: x, y0: y, x1: x, y1: y, additive, before: selIds });
    } else if (e.pointerType !== 'touch') {
      addNoteAt(x, y); // a finger tap is handled on click instead, so scrolling with a finger never adds notes
    }
  }
  function gridMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!marquee) return;
    const { x, y } = gridPos(e);
    const m = { ...marquee, x1: x, y1: y };
    setMarquee(m);
    const hit = notesInRect(track.notes, m.x0 / BEAT_W, m.x1 / BEAT_W, pitchAt(m.y0), pitchAt(m.y1)).map(n => n.id);
    setSelected(new Set([...(m.additive ? m.before : []), ...hit]));
  }
  function gridUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!marquee) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const tiny = Math.hypot(marquee.x1 - marquee.x0, marquee.y1 - marquee.y0) < 4;
    if (tiny && !marquee.additive) setSelected(new Set());
    setMarquee(null);
  }
  function gridClick(e: React.MouseEvent<HTMLDivElement>) {
    if (gridPointer.current === 'touch' && tool === 'draw') { const { x, y } = gridPos(e); addNoteAt(x, y); }
  }

  function startDrag(e: React.PointerEvent<HTMLDivElement>, n: Note) {
    if (e.button !== 0) return;
    e.stopPropagation();
    lastPointer.current = e.pointerType;
    const rect = e.currentTarget.getBoundingClientRect();
    const edge = Math.min(HANDLE, rect.width / 3);
    const mode: DragMode = e.clientX - rect.left < edge ? 'left' : rect.right - e.clientX < edge ? 'right' : 'move';
    const modifier = e.shiftKey || e.ctrlKey || e.metaKey;
    const was = selIds.has(n.id);
    let ids: Set<string>;
    if (modifier) { ids = new Set(selIds); if (was) ids.delete(n.id); else ids.add(n.id); }
    else ids = was ? new Set(selIds) : new Set([n.id]);
    setSelected(ids);
    if (!ids.has(n.id)) return; // shift-click removed it from the selection
    drag.current = { gid: uid('drag'), id: n.id, mode, x0: e.clientX, y0: e.clientY, base: track.notes, ids, lastPitch: n.pitch, moved: false, collapseOnClick: was && !modifier && ids.size > 1 };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function moveDrag(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    const dBeats = Math.round(dx / BEAT_W / GRID) * GRID;
    if (d.mode === 'move') {
      const out = moveNotes(d.base, d.ids, dBeats, -Math.round(dy / ROW_H), { ...bounds, shift: shiftInKey });
      onNotes(out, d.gid);
      const now = out.find(n => n.id === d.id);
      if (now && now.pitch !== d.lastPitch) { d.lastPitch = now.pitch; engine.preview(track, now.pitch); }
    } else {
      onNotes(resizeNotes(d.base, d.ids, d.mode, dBeats, { total, grid: GRID }), d.gid);
    }
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d && !d.moved && d.collapseOnClick) setSelected(new Set([d.id])); // a plain click on one of several selected notes selects just that note
  }

  const secPerBeat = 60 / project.tempo;

  /** Sets a note's slide (or removes it) and plays it so the change can be heard. */
  function setBend(n: Note, bend: NoteBend | undefined, key?: string, audition = true) {
    const clean = bend && bend.semitones !== 0 ? bend : undefined;
    onNotes(track.notes.map(x => {
      if (x.id !== n.id) return x;
      const { bend: _old, ...rest } = x; void _old;
      return clean ? { ...rest, bend: clean } : rest;
    }), key);
    if (audition) engine.preview(track, n.pitch, Math.min(1.5, n.duration * secPerBeat), clean);
  }

  const slideDrag = useRef<{ gid: string; y0: number; from: number; note: Note; last: number } | null>(null);
  function slideDown(e: React.PointerEvent<HTMLDivElement>, n: Note) {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    slideDrag.current = { gid: uid('slide'), y0: e.clientY, from: n.bend?.semitones ?? 0, note: n, last: n.bend?.semitones ?? 0 };
  }
  function slideMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = slideDrag.current; if (!d) return;
    const semis = clampSemitones(d.from - (e.clientY - d.y0) / ROW_H);
    if (semis === d.last) return;
    d.last = semis;
    setBend(d.note, { semitones: semis, late: d.note.bend?.late }, d.gid, false);
    engine.preview(track, d.note.pitch + semis, 0.25);
  }
  function slideUp(e: React.PointerEvent<HTMLDivElement>) {
    const d = slideDrag.current; slideDrag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d && d.last !== d.from) engine.preview(track, d.note.pitch, Math.min(1.5, d.note.duration * secPerBeat), d.last ? { semitones: d.last, late: d.note.bend?.late } : undefined);
  }

  function zoomToSelection() {
    const b = selectionBounds(track.notes, selIds);
    const el = scrollRef.current;
    if (!b || !el) return;
    tz.zoomToSpan(b.start, b.end);
    const mid = (b.low + b.high) / 2;
    el.scrollTop = Math.max(0, (HIGH - mid) * ROW_H + RULER_H - el.clientHeight / 2);
  }

  const removeNote = (id: string) => { setSelected(new Set()); onNotes(track.notes.filter(x => x.id !== id)); };
  const removeSelected = () => { setSelected(new Set()); onNotes(track.notes.filter(x => !selIds.has(x.id))); };
  const selectAll = () => setSelected(new Set(track.notes.map(n => n.id)));

  /** Moves the selection by whole steps: time in beats, pitch in rows (scale steps when "Stay in key" is on). */
  function nudge(dBeats: number, rows: number, octave = false) {
    const out = octave
      ? moveNotes(track.notes, selIds, 0, rows * 12, bounds)
      : moveNotes(track.notes, selIds, dBeats, rows, { ...bounds, shift: shiftInKey });
    if (out === track.notes) return;
    onNotes(out, 'nudge');
    if (rows !== 0) { const first = out.find(n => selIds.has(n.id)); if (first) engine.preview(track, first.pitch); }
  }

  function copySelection() {
    const clip = makeClip(track.notes, selIds);
    const b = selectionBounds(track.notes, selIds);
    if (!clip || !b) return;
    clipboard.current = { clip, next: Math.ceil(b.end / GRID) * GRID };
    flash(`Copied ${clip.notes.length} ${clip.notes.length === 1 ? 'note' : 'notes'}. Press Ctrl+V or Paste to add them.`);
  }

  function pasteSelection() {
    const c = clipboard.current;
    if (!c) return;
    const { added, dropped } = pasteClip(c.clip, c.next, total, () => uid('n'));
    if (added.length === 0) { flash('There is no room left in the song. Choose a longer song with Length at the top.'); return; }
    onNotes([...track.notes, ...added]);
    setSelected(new Set(added.map(n => n.id)));
    c.next += c.clip.length; // pasting again places the next copy right after this one
    if (dropped > 0) flash(`${dropped} ${dropped === 1 ? 'note' : 'notes'} did not fit before the end of the song.`);
  }

  /** Copies the selection and places it right after itself, ready to repeat again. */
  function repeatSelection() {
    const clip = makeClip(track.notes, selIds);
    const b = selectionBounds(track.notes, selIds);
    if (!clip || !b) return;
    const at = Math.ceil(b.end / GRID) * GRID;
    const { added, dropped } = pasteClip(clip, at, total, () => uid('n'));
    if (added.length === 0) { flash('There is no room left in the song. Choose a longer song with Length at the top.'); return; }
    clipboard.current = { clip, next: at + clip.length };
    onNotes([...track.notes, ...added]);
    setSelected(new Set(added.map(n => n.id)));
    if (dropped > 0) flash(`${dropped} ${dropped === 1 ? 'note' : 'notes'} did not fit before the end of the song.`);
  }

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'a') { e.preventDefault(); selectAll(); return; }
      if (mod && k === 'v') { e.preventDefault(); pasteSelection(); return; }
      if (selIds.size === 0) return;
      if (mod && k === 'c') { e.preventDefault(); copySelection(); return; }
      if (mod && k === 'd') { e.preventDefault(); repeatSelection(); return; }
      if (mod) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return; }
      if (e.key === 'Escape') { setSelected(new Set()); return; }
      const big = e.shiftKey;
      if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(big ? -project.beatsPerBar / 4 : -GRID, 0); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(big ? project.beatsPerBar / 4 : GRID, 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, 1, big); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, -1, big); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function addChord(degree: number) {
    // drop a triad at the first free bar-aligned spot after the last note
    const lastEnd = track.notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
    const start = Math.min(Math.ceil(lastEnd / project.beatsPerBar) * project.beatsPerBar, total - project.beatsPerBar);
    const pitches = triadPitches(degree, project.key, project.scaleName, 48);
    const notes = pitches.map(pitch => ({ id: uid('n'), pitch, start, duration: project.beatsPerBar }));
    onNotes([...track.notes, ...notes]);
    pitches.forEach(p => engine.preview(track, p, 0.8));
  }

  const rowBg = (p: number) =>
    isInScale(p, project.key, project.scaleName)
      ? ((p - project.key) % 12 === 0 ? 'var(--row-root)' : 'var(--row-in)')
      : isBlackKey(p) ? 'var(--row-black)' : 'var(--roll-bg)';

  const lengthLabel = DURATION_LABELS.find(d => d.beats === duration)?.label ?? 'Custom';
  const gridW = total * BEAT_W, gridH = rows.length * ROW_H;

  return (
    <section className="roll" style={{ ['--c' as string]: track.color }}>
      <div className="roll-bar">
        <Segmented label="Tool" value={tool} onChange={setTool}
          options={[
            { value: 'draw', label: <><Icon name="pencil" size={15} />Draw</>, title: 'Click the grid to add notes' },
            { value: 'select', label: <><Icon name="select" size={15} />Select</>, title: 'Drag a box around notes to select them (or hold Shift in Draw mode)' },
          ]} />
        <Popover buttonClass="btn small" title="How long each new note is" trigger={<><span className="muted">Note</span> {lengthLabel}<Icon name="chevron" size={14} /></>}>
          {close => (
            <div role="menu" className="length-menu">
              <div className="menu-title">New note length</div>
              {DURATION_LABELS.map(d => (
                <button key={d.label} role="menuitemradio" aria-checked={d.beats === duration} className={'menu-item' + (d.beats === duration ? ' picked' : '')} onClick={() => { setDuration(d.beats); close(); }}>
                  <span className="len-bar" style={{ width: 8 + d.beats * 14 }} />
                  <span className="menu-label">{d.label}</span><kbd>{LENGTH_HINT[d.label]}</kbd>
                </button>
              ))}
            </div>
          )}
        </Popover>
        <Switch checked={lock} onChange={setLock}>Stay in key</Switch>
        <span className="spacer" />
        {clashes.size > 0 && (
          <span className="clash-chip" title="Notes a semitone from a note on another track clash. They have a dashed red outline.">
            <Icon name="eye" size={14} />{clashes.size} {clashes.size === 1 ? 'clash' : 'clashes'}
          </span>
        )}
        <Popover buttonClass="btn small" align="end" title="Add a chord that fits your key" trigger={<><Icon name="note" size={15} /><span className="lbl">Chords</span><Icon name="chevron" size={14} /></>}>
          {close => (
            <div className="chord-panel">
              <div className="menu-title">Add a chord</div>
              <div className="chord-grid">
                {roman.map((name, i) => (
                  <button key={name} className={'chord-chip' + (suggested.has(i) ? ' suggested' : '')} title={suggested.has(i) ? `${name}: ${suggested.get(i)}` : 'A chord that fits your key'}
                    onClick={() => { addChord(i); close(); }}>{name}</button>
                ))}
              </div>
              <p className="chord-hint">
                {prevChord === null ? 'Start with ' : `After ${roman[prevChord]}, try `}
                {suggestions.slice(0, 2).map((x, i) => <span key={x.degree}>{i > 0 && ' or '}<strong>{roman[x.degree]}</strong> ({x.reason})</span>)}
              </p>
            </div>
          )}
        </Popover>
        <Popover buttonClass="btn small" align="end" title="Zoom, snapping and what to show on the grid" trigger={<><Icon name="eye" size={15} /><span className="lbl">View</span><Icon name="chevron" size={14} /></>}>
          <div className="view-panel">
            <label className="zoom"><span>Time zoom</span>
              <Slider min={0} max={1} step={0.01} value={tz.maxZoom > 1 ? Math.log(tz.zoom) / Math.log(tz.maxZoom) : 0} label="Time zoom"
                onChange={v => tz.zoomTo(Math.pow(tz.maxZoom, v))} />
            </label>
            <label className="zoom"><span>Note height</span>
              <Slider min={MIN_ROW_H} max={MAX_ROW_H} step={1} value={rowH} label="Note height" onChange={changeRowH} />
            </label>
            <div className="snap-field">
              <span className="muted small">Snap notes to</span>
              <Segmented size="sm" label="Snap" value={snapPref === 'auto' ? 'auto' : String(snapPref)} onChange={v => setSnapPref(v === 'auto' ? 'auto' : +v)}
                options={[{ value: 'auto', label: 'Auto', title: 'Snaps finer as you zoom in' }, ...SNAPS.map(x => ({ value: String(x.value), label: x.label, title: x.title }))]} />
              <span className="muted small">Now snapping to {GRID >= 0.5 ? '½' : GRID >= 0.25 ? '¼' : GRID >= 0.125 ? '⅛' : '1⁄16'} of a beat</span>
            </div>
            <Switch checked={follow} onChange={setFollow}>Follow the playhead</Switch>
            <Switch checked={showGhosts} onChange={setShowGhosts}>Show other tracks faintly</Switch>
            <Switch checked={showClashes} onChange={setShowClashes}>Highlight clashes</Switch>
          </div>
        </Popover>
      </div>

      <div className="roll-main">
        <div className="roll-scroll" ref={scrollRef}>
          <div className="roll-inner" style={{ width: KEYS_W + gridW }}>
            <div className="ruler" style={{ height: RULER_H }}>
              <div className="corner" style={{ width: KEYS_W }} />
              <div className="ruler-track" style={{ width: gridW }}>
                {GRID * BEAT_W >= 8 && <div className="snap-ticks" style={{ ['--snap-w' as string]: `${GRID * BEAT_W}px` }} />}
                {Array.from({ length: total }, (_, b) => {
                  const bar = b % project.beatsPerBar === 0;
                  const label = bar ? String(b / project.beatsPerBar + 1) : BEAT_W >= 64 ? `${b / project.beatsPerBar + 1 | 0}.${(b % project.beatsPerBar) + 1}` : '';
                  return <div key={b} className={'tick' + (bar ? ' bar' : '')} style={{ left: b * BEAT_W }}>{label && <span className={bar ? '' : 'sub'}>{label}</span>}</div>;
                })}
                {playhead > 0 && <div className="ruler-head" style={{ left: playhead * BEAT_W }} />}
              </div>
            </div>
            <div className="roll-body">
              <div className="keys" style={{ width: KEYS_W }}>
                {rows.map(p => (
                  <div key={p} className={'key' + (isBlackKey(p) ? ' black' : '')} style={{ height: ROW_H }} onMouseDown={() => engine.preview(track, p)}>
                    {p % 12 === 0 || ROW_H >= 26 ? noteName(p) : ''}
                  </div>
                ))}
              </div>
              <div className={'grid' + (tool === 'select' ? ' select-tool' : '')} style={{ width: gridW, height: gridH }}
                onPointerDown={gridDown} onPointerMove={gridMove} onPointerUp={gridUp} onPointerCancel={gridUp} onClick={gridClick}>
                {rows.map(p => <div key={p} className="row" style={{ height: ROW_H, background: rowBg(p) }} />)}
                {GRID * BEAT_W >= 8 && <div className="snap-lines" style={{ width: gridW, height: gridH, ['--snap-w' as string]: `${GRID * BEAT_W}px` }} />}
                {Array.from({ length: total }, (_, b) => (
                  <div key={b} className={'beat-line' + (b % project.beatsPerBar === 0 ? ' bar' : '')} style={{ left: b * BEAT_W }} />
                ))}
                {showGhosts && others.flatMap(t => t.notes.filter(n => n.pitch >= LOW && n.pitch <= HIGH).map(n => (
                  <div key={t.id + n.id} className="ghost"
                    style={{ left: n.start * BEAT_W, top: (HIGH - n.pitch) * ROW_H, width: n.duration * BEAT_W - 1, height: ROW_H - 2, ['--c' as string]: t.color }} />
                )))}
                {track.notes.map(n => (
                  <div key={n.id} className={'note' + (selIds.has(n.id) ? ' selected' : '') + (clashes.has(n.id) ? ' clash' : '')}
                    title={clashes.has(n.id) ? `Clashes with ${noteName(clashes.get(n.id)!.otherPitch)} on ${clashes.get(n.id)!.otherTrack}. Try moving it one step.` : 'Drag the edges to resize, drag the middle to move. Shift-click to select more. Press Delete to remove'}
                    style={{ left: n.start * BEAT_W, top: (HIGH - n.pitch) * ROW_H, width: Math.max(4, n.duration * BEAT_W - 1), height: ROW_H - 2 }}
                    onPointerDown={e => startDrag(e, n)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
                    onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
                    onDoubleClick={e => { e.stopPropagation(); if (lastPointer.current === 'mouse') removeNote(n.id); }}
                    onContextMenu={e => { e.preventDefault(); if (lastPointer.current === 'mouse') removeNote(n.id); }}>
                    <span className="grip left" /><span className="label">{n.duration * BEAT_W >= 36 ? noteName(n.pitch) : ''}</span><span className="grip right" />
                  </div>
                ))}
                <svg className="slides" width={gridW} height={gridH} aria-hidden="true">
                  {track.notes.filter(n => n.bend).map(n => {
                    const x0 = n.start * BEAT_W, x1 = (n.start + n.duration) * BEAT_W - 1;
                    const y0 = (HIGH - n.pitch) * ROW_H + ROW_H / 2, y1 = y0 - n.bend!.semitones * ROW_H;
                    const xh = x0 + (n.bend!.late ? 0.5 : 0) * (x1 - x0);
                    return <g key={n.id}><polyline points={`${x0},${y0} ${xh},${y0} ${x1},${y1}`} fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" /><circle cx={x1} cy={y1} r="3" fill="#fff" /></g>;
                  })}
                </svg>
                {selectedNote && (
                  <div className="slide-handle" title="Drag up or down to slide this note"
                    style={{ left: (selectedNote.start + selectedNote.duration) * BEAT_W + 3, top: (HIGH - selectedNote.pitch - (selectedNote.bend?.semitones ?? 0)) * ROW_H + ROW_H / 2 - 7 }}
                    onPointerDown={e => slideDown(e, selectedNote)} onPointerMove={slideMove} onPointerUp={slideUp} onPointerCancel={slideUp}
                    onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} />
                )}
                {marquee && <div className="marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />}
                {playhead > 0 && <div className="playhead" style={{ left: playhead * BEAT_W }} />}
              </div>
            </div>
          </div>
        </div>

        <div className="zoom-fab" role="group" aria-label="Zoom">
          <button className="btn-icon" onClick={() => tz.zoomBy(1.5)} disabled={tz.zoom >= tz.maxZoom - 0.001} title="Zoom in (+ or Ctrl+scroll)" aria-label="Zoom in"><Icon name="zoomIn" /></button>
          <button className="btn-icon" onClick={() => tz.zoomBy(1 / 1.5)} disabled={tz.atFit} title="Zoom out (−)" aria-label="Zoom out"><Icon name="zoomOut" /></button>
          <button className="btn-icon" onClick={tz.reset} disabled={tz.atFit} title="Fit the whole song in the window (0)" aria-label="Fit the song"><Icon name="fit" /></button>
          {!tz.atFit && <span className="zoom-badge" aria-hidden="true">{tz.zoom >= 10 ? Math.round(tz.zoom) : tz.zoom.toFixed(1)}×</span>}
        </div>

        {track.notes.length === 0 && (
          <div className="empty-hint" aria-hidden="true">
            <Icon name="pencil" size={22} />
            <strong>Click anywhere on the grid to add your first note</strong>
            <span>Notes snap to your key. Or use Chords for an instant start.</span>
          </div>
        )}

        {(selNotes.length > 0 || message) && (
          <div className="sel-wrap">
            {message && <div className="roll-toast" role="status">{message}</div>}
            {selNotes.length > 0 && (
              <div className="sel-bar" role="toolbar" aria-label="Selected notes">
                <span className="sel-count">{selNotes.length} selected</span>
                <span className="sel-group">
                  <button className="btn-icon" onClick={() => nudge(-GRID, 0)} title="Move earlier (←)" aria-label="Move earlier"><Icon name="left" /></button>
                  <button className="btn-icon" onClick={() => nudge(GRID, 0)} title="Move later (→)" aria-label="Move later"><Icon name="right" /></button>
                </span>
                <span className="sel-group">
                  <button className="btn-icon" onClick={() => nudge(0, 1)} title="Higher (↑)" aria-label="Move higher"><Icon name="up" /></button>
                  <button className="btn-icon" onClick={() => nudge(0, -1)} title="Lower (↓)" aria-label="Move lower"><Icon name="down" /></button>
                  <button className="btn-text" onClick={() => nudge(0, 1, true)} title="An octave higher (Shift+↑)">Octave ↑</button>
                  <button className="btn-text" onClick={() => nudge(0, -1, true)} title="An octave lower (Shift+↓)">Octave ↓</button>
                </span>
                <span className="sel-group">
                  <button className="btn-icon" onClick={repeatSelection} title="Copy these notes and place the copy right after them (Ctrl+D)" aria-label="Repeat"><Icon name="repeat" /></button>
                  <button className="btn-icon" onClick={copySelection} title="Copy (Ctrl+C)" aria-label="Copy"><Icon name="copy" /></button>
                  <button className="btn-icon" onClick={zoomToSelection} title="Zoom in on the selected notes" aria-label="Zoom to selection"><Icon name="zoomIn" /></button>
                  {clipboard.current && <button className="btn-icon" onClick={pasteSelection} title="Paste (Ctrl+V). Each paste lands after the previous one." aria-label="Paste"><Icon name="paste" /></button>}
                </span>
                {selectedNote && (
                  <Popover up buttonClass="btn small" align="center" title="Make this note slide up or down" trigger={<><Icon name="slide" size={15} />Slide{selectedNote.bend ? ` ${selectedNote.bend.semitones > 0 ? '+' : ''}${selectedNote.bend.semitones}` : ''}</>}>
                    <div className="slide-panel">
                      <div className="menu-title">Slide this note</div>
                      <label className="slide-row">
                        <input type="range" min={-12} max={12} step={1} value={selectedNote.bend?.semitones ?? 0} aria-label="Slide amount in semitones"
                          onChange={e => setBend(selectedNote, { semitones: +e.target.value, late: selectedNote.bend?.late }, `bend:${selectedNote.id}`)} />
                        <span className="slide-readout">
                          {(selectedNote.bend?.semitones ?? 0) === 0 ? 'none' : `${selectedNote.bend!.semitones > 0 ? 'up' : 'down'} ${Math.abs(selectedNote.bend!.semitones)} ${Math.abs(selectedNote.bend!.semitones) === 1 ? 'step' : 'steps'}`}
                        </span>
                      </label>
                      <Switch checked={!!selectedNote.bend?.late} onChange={v => selectedNote.bend && setBend(selectedNote, { ...selectedNote.bend, late: v || undefined })}>Hold first, then slide</Switch>
                      <div className="slide-actions">
                        <button className="btn small" disabled={slideToNext(selectedNote, track.notes) === null} title="Glide from this note into the next one"
                          onClick={() => { const to = slideToNext(selectedNote, track.notes); if (to !== null) setBend(selectedNote, { semitones: to, late: selectedNote.bend?.late }); }}>Slide to next note</button>
                        {selectedNote.bend && <button className="btn small" onClick={() => setBend(selectedNote, undefined, undefined, false)}>Remove slide</button>}
                      </div>
                      <p className="chord-hint">You can also drag the dot at the end of the note up or down.</p>
                    </div>
                  </Popover>
                )}
                <button className="btn-icon danger-icon" onClick={removeSelected} title="Remove (Delete)" aria-label="Remove"><Icon name="trash" /></button>
                <button className="btn-icon" onClick={() => setSelected(new Set())} title="Deselect (Esc)" aria-label="Deselect"><Icon name="x" /></button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="roll-foot">
        <span><kbd>Click</kbd> add a note</span>
        <span><kbd>Shift</kbd>+drag select several</span>
        <span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> nudge</span>
        <span><kbd>Ctrl</kbd>+<kbd>D</kbd> repeat</span>
        <span><kbd>Space</kbd> play</span>
        {tool === 'select' && <button className="btn-text" onClick={selectAll} disabled={track.notes.length === 0}>Select all</button>}
      </div>
    </section>
  );
}
