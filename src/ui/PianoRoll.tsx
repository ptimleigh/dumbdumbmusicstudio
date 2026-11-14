import { useEffect, useRef, useState } from 'react';
import type { Note, Project, Track } from '../music/types';
import { DURATION_LABELS, isBlackKey, isInScale, noteName, snapToScale } from '../music/theory';
import { clampSemitones, slideToNext, type NoteBend } from '../music/bend';
import { chordScaleOf, findClashes, lastChord, ROMAN, suggestNext, triadPitches } from '../music/harmony';
import { engine } from '../audio/engine';
import { uid } from '../music/project';

const LOW = 48, HIGH = 84; // C3..C6
const BEAT_W = 48, ROW_H = 18, GRID = 0.25, HANDLE = 7;

type DragMode = 'move' | 'left' | 'right';
interface Drag { gid: string; id: string; mode: DragMode; x0: number; y0: number; orig: Note; base: Note[]; lastPitch: number }

export function PianoRoll({ project, track, playhead, onNotes }: {
  project: Project; track: Track; playhead: number; onNotes: (n: Note[], key?: string) => void;
}) {
  const [duration, setDuration] = useState(1);
  const [lock, setLock] = useState(true);
  const [showGhosts, setShowGhosts] = useState(true);
  const [showClashes, setShowClashes] = useState(true);
  const total = project.bars * project.beatsPerBar;
  const drag = useRef<Drag | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const lastPointer = useRef<string>('mouse'); // double-click and right-click only remove notes with a mouse, never by accident on touch
  const selectedNote = track.notes.find(n => n.id === selected) ?? null;
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

  function onGridDown(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let pitch = HIGH - Math.floor(y / ROW_H);
    const start = Math.floor(x / BEAT_W / GRID) * GRID;
    if (start + GRID > total) return;
    setSelected(null);
    if (lock) pitch = snapToScale(pitch, project.key, project.scaleName);
    const note: Note = { id: uid('n'), pitch, start, duration: Math.min(duration, total - start) };
    onNotes([...track.notes, note]);
    engine.preview(track, pitch);
  }

  function startDrag(e: React.PointerEvent<HTMLDivElement>, n: Note) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const edge = Math.min(HANDLE, rect.width / 3);
    const mode: DragMode = e.clientX - rect.left < edge ? 'left' : rect.right - e.clientX < edge ? 'right' : 'move';
    setSelected(n.id);
    lastPointer.current = e.pointerType;
    drag.current = { gid: uid('drag'), id: n.id, mode, x0: e.clientX, y0: e.clientY, orig: n, base: track.notes, lastPitch: n.pitch };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function moveDrag(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    const dBeats = Math.round((e.clientX - d.x0) / BEAT_W / GRID) * GRID;
    const { orig } = d;
    let next: Note = orig;
    if (d.mode === 'right') {
      const duration = Math.min(Math.max(GRID, orig.duration + dBeats), total - orig.start);
      next = { ...orig, duration };
    } else if (d.mode === 'left') {
      const end = orig.start + orig.duration;
      const start = Math.min(Math.max(0, orig.start + dBeats), end - GRID);
      next = { ...orig, start, duration: end - start };
    } else {
      const start = Math.min(Math.max(0, orig.start + dBeats), total - orig.duration);
      let pitch = Math.min(HIGH, Math.max(LOW, orig.pitch - Math.round((e.clientY - d.y0) / ROW_H)));
      if (lock) pitch = snapToScale(pitch, project.key, project.scaleName);
      next = { ...orig, start, pitch };
      if (pitch !== d.lastPitch) { d.lastPitch = pitch; engine.preview(track, pitch); }
    }
    onNotes(d.base.map(n => (n.id === d.id ? next : n)), d.gid);
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
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

  const removeNote = (id: string) => { setSelected(null); onNotes(track.notes.filter(x => x.id !== id)); };

  // Delete or Backspace removes the selected note
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (!selectedNote || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeNote(selectedNote.id); }
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
        {selectedNote && <button className="chip danger" onClick={() => removeNote(selectedNote.id)} title="Or press Delete">Remove selected note</button>}
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
      <div className="roll-scroll">
        <div className="keys">
          {rows.map(p => (
            <div key={p} className="key" style={{ height: ROW_H, background: isBlackKey(p) ? '#222' : '#eee', color: isBlackKey(p) ? '#ddd' : '#333' }}
              onMouseDown={() => engine.preview(track, p)}>
              {p % 12 === 0 || isInScale(p, project.key, project.scaleName) && (p - project.key) % 12 === 0 ? noteName(p) : ''}
            </div>
          ))}
        </div>
        <div className="grid" style={{ width: total * BEAT_W, height: rows.length * ROW_H }} onMouseDown={onGridDown}>
          {rows.map(p => <div key={p} className="row" style={{ height: ROW_H, background: rowBg(p) }} />)}
          {Array.from({ length: total }, (_, b) => (
            <div key={b} className={'beat-line' + (b % project.beatsPerBar === 0 ? ' bar' : '')} style={{ left: b * BEAT_W }} />
          ))}
          {showGhosts && others.flatMap(t => t.notes.filter(n => n.pitch >= LOW && n.pitch <= HIGH).map(n => (
            <div key={t.id + n.id} className="ghost"
              style={{ left: n.start * BEAT_W, top: (HIGH - n.pitch) * ROW_H, width: n.duration * BEAT_W - 1, height: ROW_H - 1, background: t.color }} />
          )))}
          {track.notes.map(n => (
            <div key={n.id} className={'note' + (n.id === selected ? ' selected' : '') + (clashes.has(n.id) ? ' clash' : '')}
              title={clashes.has(n.id) ? `Clashes with ${noteName(clashes.get(n.id)!.otherPitch)} on ${clashes.get(n.id)!.otherTrack}. Try moving it one step.` : 'Drag the edges to resize, drag the middle to move. Select a note and press Delete to remove it'}
              style={{ left: n.start * BEAT_W, top: (HIGH - n.pitch) * ROW_H, width: n.duration * BEAT_W - 1, height: ROW_H - 1, background: track.color }}
              onPointerDown={e => startDrag(e, n)} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
              onMouseDown={e => e.stopPropagation()}
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
              onMouseDown={e => e.stopPropagation()} />
          )}
          <div className="playhead" style={{ left: playhead * BEAT_W, display: playhead > 0 ? 'block' : 'none' }} />
        </div>
      </div>
      <p className="help">Tap or click the grid to add a note · drag a note's edges to resize it, or its middle to move it · select a note to slide it, or remove it with Delete · Space to play/stop</p>
    </section>
  );
}
