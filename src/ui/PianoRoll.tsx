import { useEffect, useRef, useState } from 'react';
import type { Note, Project, Track } from '../music/types';
import { DURATION_LABELS, isBlackKey, isInScale, noteName, snapToScale } from '../music/theory';
import { clampSemitones, slideToNext, type NoteBend } from '../music/bend';
import { makeClip, moveNotes, notesInRect, pasteClip, resizeNotes, selectionBounds, stepInScale, type Clip } from '../music/edit';
import { chordScaleOf, findClashes, lastChord, ROMAN, suggestNext, triadPitches } from '../music/harmony';
import { engine } from '../audio/engine';
import { uid } from '../music/project';

const LOW = 48, HIGH = 84; // C3..C6
const BEAT_W = 48, ROW_H = 18, GRID = 0.25, HANDLE = 7;

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
  const total = project.bars * project.beatsPerBar;
  const drag = useRef<Drag | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [tool, setTool] = useState<'draw' | 'select'>('draw');
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const clipboard = useRef<{ clip: Clip; next: number } | null>(null);
  const gridPointer = useRef<string>('mouse');
  const lastPointer = useRef<string>('mouse'); // double-click and right-click only remove notes with a mouse, never by accident on touch
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
  const prevChord = lastChord(track.notes, project.beatsPerBar, project.key, project.scaleName)
    ?? (others.find(t => t.role === 'chords') ? lastChord(others.find(t => t.role === 'chords')!.notes, project.beatsPerBar, project.key, project.scaleName) : null);
  const suggestions = suggestNext(prevChord, project.scaleName);
  const suggested = new Map(suggestions.map(x => [x.degree, x.reason]));

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
  const updateNote = (id: string, patch: Partial<Note>, key?: string) =>
    onNotes(track.notes.map(n => (n.id === id ? { ...n, ...patch } : n)), key);

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

  const removeNote = (id: string) => { setSelected(new Set()); onNotes(track.notes.filter(x => x.id !== id)); };
  const removeSelected = () => { setSelected(new Set()); onNotes(track.notes.filter(x => !selIds.has(x.id))); };
  const selectAll = () => setSelected(new Set(track.notes.map(n => n.id)));

  /** Moves the selection by whole steps: time in beats, pitch in rows (scale steps when "Keep me in key" is on). */
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
      else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, big ? 1 : 1, big); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, big ? -1 : -1, big); }
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
      ? ((p - project.key) % 12 === 0 ? 'var(--root)' : 'var(--inscale)')
      : isBlackKey(p) ? 'var(--black)' : 'var(--white)';

  return (
    <section className="roll">
      <div className="roll-tools">
        <span>Note length:</span>
        {DURATION_LABELS.map(d => (
          <button key={d.label} className={d.beats === duration ? 'chip on' : 'chip'} onClick={() => setDuration(d.beats)}>{d.label}</button>
        ))}
        <label className="check"><input type="checkbox" checked={lock} onChange={e => setLock(e.target.checked)} /> Keep me in key</label>
        <span className="tool-switch" role="group" aria-label="Tool">
          <button className={tool === 'draw' ? 'chip on' : 'chip'} onClick={() => setTool('draw')} title="Click the grid to add notes">✏ Draw</button>
          <button className={tool === 'select' ? 'chip on' : 'chip'} onClick={() => setTool('select')} title="Drag a box around notes to select them. Hold Shift in Draw mode for the same.">⬚ Select</button>
          <button className="chip" onClick={selectAll} disabled={track.notes.length === 0} title="Ctrl+A">Select all</button>
        </span>
        <span className="spacer" />
        <span>Add chord:</span>
        {roman.map((name, i) => (
          <button key={name} className={'chip' + (suggested.has(i) ? ' suggested' : '')} onClick={() => addChord(i)}
            title={suggested.has(i) ? `${name}: ${suggested.get(i)}` : 'Adds a chord that fits your key'}>{name}</button>
        ))}
      </div>
      <div className="roll-tools sub">
        <label className="check"><input type="checkbox" checked={showGhosts} onChange={e => setShowGhosts(e.target.checked)} /> Show other tracks faintly</label>
        <label className="check"><input type="checkbox" checked={showClashes} onChange={e => setShowClashes(e.target.checked)} /> Highlight clashes</label>
        {showClashes && clashes.size > 0 && <span className="warn">⚠ {clashes.size} {clashes.size === 1 ? 'note clashes' : 'notes clash'} with another track (dashed red)</span>}
        <span className="spacer" />
        <span className="hint">
          {prevChord === null ? 'Start with ' : `After ${roman[prevChord]}, try `}
          {suggestions.slice(0, 2).map((x, i) => <span key={x.degree}>{i > 0 && ' or '}<strong>{roman[x.degree]}</strong> ({x.reason})</span>)}
        </span>
      </div>
      <div className="roll-scroll">
        <div className="keys">
          {rows.map(p => (
            <div key={p} className="key" style={{ height: ROW_H, background: isBlackKey(p) ? '#222' : '#eee', color: isBlackKey(p) ? '#ddd' : '#333' }}
              onMouseDown={() => engine.preview(track, p)}>
              {p % 12 === 0 || isInScale(p, project.key, project.scaleName) && (p - project.key) % 12 === 0 ? noteName(p) : ''}
            </div>
          ))}
        </div>
        <div className={'grid' + (tool === 'select' ? ' select-tool' : '')} style={{ width: total * BEAT_W, height: rows.length * ROW_H }}
          onPointerDown={gridDown} onPointerMove={gridMove} onPointerUp={gridUp} onPointerCancel={gridUp} onClick={gridClick}>
          {rows.map(p => <div key={p} className="row" style={{ height: ROW_H, background: rowBg(p) }} />)}
          {Array.from({ length: total }, (_, b) => (
            <div key={b} className={'beat-line' + (b % project.beatsPerBar === 0 ? ' bar' : '')} style={{ left: b * BEAT_W }} />
          ))}
          {showGhosts && others.flatMap(t => t.notes.filter(n => n.pitch >= LOW && n.pitch <= HIGH).map(n => (
            <div key={t.id + n.id} className="ghost"
              style={{ left: n.start * BEAT_W, top: (HIGH - n.pitch) * ROW_H, width: n.duration * BEAT_W - 1, height: ROW_H - 1, background: t.color }} />
          )))}
          {track.notes.map(n => (
            <div key={n.id} className={'note' + (selIds.has(n.id) ? ' selected' : '') + (clashes.has(n.id) ? ' clash' : '')}
              title={clashes.has(n.id) ? `Clashes with ${noteName(clashes.get(n.id)!.otherPitch)} on ${clashes.get(n.id)!.otherTrack}. Try moving it one step.` : 'Drag the edges to resize, drag the middle to move. Shift-click to select more. Press Delete to remove'}
              style={{ left: n.start * BEAT_W, top: (HIGH - n.pitch) * ROW_H, width: n.duration * BEAT_W - 1, height: ROW_H - 1, background: track.color }}
              onPointerDown={e => startDrag(e, n)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
              onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
              onDoubleClick={e => { e.stopPropagation(); if (lastPointer.current === 'mouse') removeNote(n.id); }}
              onContextMenu={e => { e.preventDefault(); if (lastPointer.current === 'mouse') removeNote(n.id); }}>
              <span className="grip left" /><span className="label">{n.duration >= 1 ? noteName(n.pitch) : ''}</span><span className="grip right" />
            </div>
          ))}
          <svg className="slides" width={total * BEAT_W} height={rows.length * ROW_H} aria-hidden="true">
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
          <div className="playhead" style={{ left: playhead * BEAT_W, display: playhead > 0 ? 'block' : 'none' }} />
        </div>
      </div>
      {(selNotes.length > 0 || (message !== null) || clipboard.current) && (
        <div className="roll-tools sub sel-tools">
          {selNotes.length > 0 && <>
            <strong>{selNotes.length} {selNotes.length === 1 ? 'note' : 'notes'} selected</strong>
            <span className="btn-group" role="group" aria-label="Move in time">
              <button className="chip" onClick={() => nudge(-GRID, 0)} title="Move earlier (←)" aria-label="Move earlier">◀</button>
              <button className="chip" onClick={() => nudge(GRID, 0)} title="Move later (→)" aria-label="Move later">▶</button>
            </span>
            <span className="btn-group" role="group" aria-label="Move in pitch">
              <button className="chip" onClick={() => nudge(0, 1)} title="Higher (↑)" aria-label="Move higher">▲</button>
              <button className="chip" onClick={() => nudge(0, -1)} title="Lower (↓)" aria-label="Move lower">▼</button>
              <button className="chip" onClick={() => nudge(0, 1, true)} title="An octave higher (Shift+↑)">Octave ▲</button>
              <button className="chip" onClick={() => nudge(0, -1, true)} title="An octave lower (Shift+↓)">Octave ▼</button>
            </span>
            <button className="chip" onClick={repeatSelection} title="Copy these notes and place the copy right after them (Ctrl+D)">Repeat</button>
            <button className="chip" onClick={copySelection} title="Ctrl+C">Copy</button>
          </>}
          {clipboard.current && <button className="chip" onClick={pasteSelection} title="Ctrl+V. Each paste lands after the previous one.">Paste</button>}
          {selNotes.length > 0 && <button className="chip danger" onClick={removeSelected} title="Delete">Remove</button>}
          {message && <span className="notice-inline" role="status">{message}</span>}
        </div>
      )}
      {selectedNote && (
        <div className="roll-tools sub slide-tools">
          <strong>Slide</strong>
          <input type="range" min={-12} max={12} step={1} value={selectedNote.bend?.semitones ?? 0} aria-label="Slide amount in semitones"
            onChange={e => setBend(selectedNote, { semitones: +e.target.value, late: selectedNote.bend?.late }, `bend:${selectedNote.id}`)} />
          <span className="slide-readout">
            {(selectedNote.bend?.semitones ?? 0) === 0 ? 'none' : `${selectedNote.bend!.semitones > 0 ? 'up' : 'down'} ${Math.abs(selectedNote.bend!.semitones)} ${Math.abs(selectedNote.bend!.semitones) === 1 ? 'step' : 'steps'}`}
          </span>
          <label className="check"><input type="checkbox" checked={!!selectedNote.bend?.late} disabled={!selectedNote.bend}
            onChange={e => selectedNote.bend && setBend(selectedNote, { ...selectedNote.bend, late: e.target.checked || undefined })} /> Hold first, then slide</label>
          <button className="chip" disabled={slideToNext(selectedNote, track.notes) === null}
            title="Glide from this note into the next one"
            onClick={() => { const to = slideToNext(selectedNote, track.notes); if (to !== null) setBend(selectedNote, { semitones: to, late: selectedNote.bend?.late }); }}>Slide to next note</button>
          {selectedNote.bend && <button className="chip" onClick={() => setBend(selectedNote, undefined, undefined, false)}>Remove slide</button>}
          <span className="hint">Or drag the dot at the end of the note up or down.</span>
        </div>
      )}
      <p className="help">Click the grid to add a note · drag a note's edges to resize it, or its middle to move it · drag a box (or Shift-click) to select several · arrow keys nudge, Ctrl+C / V / D copy, paste, repeat · Delete removes · Space plays</p>
    </section>
  );
}
