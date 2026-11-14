import { useEffect, useRef, useState } from 'react';
import type { Note, Project, Track } from '../music/types';
import { DRUM_PATTERNS, DRUM_ROWS, STEP, STEPS_PER_BEAT, drumClip, hitsInBox, moveHits, rowIndex, stepOf, stepsPerBar, withoutDuplicates } from '../music/drums';
import { pasteClip, type Clip } from '../music/edit';
import { uid } from '../music/project';
import { engine } from '../audio/engine';
import { Icon, Popover, Segmented, useElementWidth, ZoomControls } from './kit';
import { useTimeZoom } from './useZoom';
import { Ruler } from './Ruler';
import type { Region } from '../audio/transport';

const ROW_H = 34, LABEL_W = 104, RULER_H = 28;

interface Paint { gid: string; paint: boolean; cur: Note[]; last: string }
interface MoveDrag { gid: string; x0: number; y0: number; base: Note[]; ids: Set<string>; anchor: string; lastRow: number; moved: boolean; collapse: boolean }
interface Marquee { x0: number; y0: number; x1: number; y1: number; additive: boolean; before: ReadonlySet<string> }

export function DrumGrid({ project, track, playhead, playing, startBeat, loop, loopOn, onSeek, onLoop, onNotes }: {
  project: Project; track: Track; playhead: number; playing: boolean; startBeat: number; loop: Region | null; loopOn: boolean;
  onSeek: (beat: number) => void; onLoop: (r: Region | null) => void; onNotes: (n: Note[], key?: string) => void;
}) {
  const total = project.bars * project.beatsPerBar;
  const steps = total * STEPS_PER_BEAT;
  const [scrollRef, areaWidth] = useElementWidth<HTMLDivElement>();
  // the song always fits the width of the screen; zooming magnifies it
  const tz = useTimeZoom({ scrollRef, areaWidth, total, leftW: LABEL_W, minBeat: 40, maxBeat: 400, playhead: playing ? playhead : 0, follow: true, focusBeat: startBeat });
  const BEAT_W = tz.beatW;
  const STEP_W = BEAT_W / STEPS_PER_BEAT;

  const [tool, setTool] = useState<'draw' | 'select'>('draw');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const paint = useRef<Paint | null>(null);
  const moving = useRef<MoveDrag | null>(null);
  const clipboard = useRef<{ clip: Clip; next: number } | null>(null);

  // hits past the end of a shortened song are kept but not shown
  const visible = track.notes.filter(n => n.start < total && rowIndex(n.pitch) >= 0);
  const selIds = new Set(visible.filter(n => selected.has(n.id)).map(n => n.id));
  const hitKey = (n: Note) => `${n.pitch}:${stepOf(n)}`;
  const active = new Set(visible.map(hitKey));
  const flash = (text: string) => { setMessage(text); window.setTimeout(() => setMessage(m => (m === text ? null : m)), 4500); };

  const gridPos = (e: { clientX: number; clientY: number; currentTarget: Element }) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const clampCell = (x: number, y: number) => ({
    step: Math.min(steps - 1, Math.max(0, Math.floor(x / STEP_W))),
    row: Math.min(DRUM_ROWS.length - 1, Math.max(0, Math.floor(y / ROW_H))),
  });
  function cellFor(e: React.PointerEvent<HTMLDivElement>) {
    const { x, y } = gridPos(e);
    const col = Math.floor(x / STEP_W), row = Math.floor(y / ROW_H);
    if (col < 0 || col >= steps || row < 0 || row >= DRUM_ROWS.length) return null;
    return { pitch: DRUM_ROWS[row].pitch, step: col, row };
  }

  function applyPaint(g: Paint, pitch: number, step: number) {
    const id = `${pitch}:${step}`;
    if (id === g.last) return;
    g.last = id;
    const exists = g.cur.some(n => hitKey(n) === id && n.start < total);
    if (g.paint && !exists) {
      g.cur = [...g.cur, { id: uid('n'), pitch, start: step * STEP, duration: STEP }];
      engine.preview(track, pitch, 0.4);
    } else if (!g.paint && exists) {
      g.cur = g.cur.filter(n => hitKey(n) !== id);
    } else return;
    onNotes(g.cur, g.gid);
  }

  function down(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    const c = cellFor(e);
    if (!c) return;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (tool === 'select' || additive) {
      e.currentTarget.setPointerCapture(e.pointerId);
      const hit = visible.find(n => rowIndex(n.pitch) === c.row && stepOf(n) === c.step);
      if (hit) {
        // select it; dragging a selected hit moves the whole selection
        const was = selIds.has(hit.id);
        let ids: Set<string>;
        if (additive) { ids = new Set(selIds); if (was) ids.delete(hit.id); else ids.add(hit.id); }
        else ids = was ? new Set(selIds) : new Set([hit.id]);
        setSelected(ids);
        if (!ids.has(hit.id)) return;
        moving.current = { gid: uid('move'), x0: e.clientX, y0: e.clientY, base: track.notes, ids, anchor: hit.id, lastRow: c.row, moved: false, collapse: was && !additive && ids.size > 1 };
        return;
      }
      const { x, y } = gridPos(e);
      setMarquee({ x0: x, y0: y, x1: x, y1: y, additive, before: selIds });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    // starting on an empty square paints; starting on a filled one erases as you drag
    const g: Paint = { gid: uid('paint'), paint: !active.has(`${c.pitch}:${c.step}`), cur: track.notes, last: '' };
    paint.current = g;
    setSelected(new Set());
    applyPaint(g, c.pitch, c.step);
  }

  function move(e: React.PointerEvent<HTMLDivElement>) {
    const m = moving.current;
    if (m) {
      const dx = e.clientX - m.x0, dy = e.clientY - m.y0;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) m.moved = true;
      const out = moveHits(m.base, m.ids, Math.round(dx / STEP_W), Math.round(dy / ROW_H), steps);
      onNotes(out, m.gid);
      const now = out.find(n => n.id === m.anchor);
      const row = now ? rowIndex(now.pitch) : m.lastRow;
      if (row !== m.lastRow) { m.lastRow = row; engine.preview(track, DRUM_ROWS[row].pitch, 0.3); }
      return;
    }
    if (marquee) {
      const { x, y } = gridPos(e);
      const next = { ...marquee, x1: x, y1: y };
      setMarquee(next);
      const a = clampCell(next.x0, next.y0), b = clampCell(next.x1, next.y1);
      const hit = hitsInBox(visible, a.step, b.step, a.row, b.row).map(n => n.id);
      setSelected(new Set([...(next.additive ? next.before : []), ...hit]));
      return;
    }
    const g = paint.current; if (!g) return;
    const c = cellFor(e); if (c) applyPaint(g, c.pitch, c.step);
  }

  function up(e: React.PointerEvent<HTMLDivElement>) {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const m = moving.current;
    moving.current = null;
    paint.current = null;
    if (m && !m.moved && m.collapse) setSelected(new Set([m.anchor])); // a plain click on one of several selected hits selects just that hit
    if (marquee) {
      const tiny = Math.hypot(marquee.x1 - marquee.x0, marquee.y1 - marquee.y0) < 4;
      if (tiny && !marquee.additive) setSelected(new Set());
      setMarquee(null);
    }
  }

  /** Moves the selection by whole steps and rows. */
  function nudge(dSteps: number, dRows: number) {
    const out = moveHits(track.notes, selIds, dSteps, dRows, steps);
    if (out === track.notes) return;
    onNotes(out, 'nudge');
    if (dRows !== 0) { const first = out.find(n => selIds.has(n.id)); if (first) engine.preview(track, first.pitch, 0.3); }
  }

  const selectAll = () => setSelected(new Set(visible.map(n => n.id)));
  const removeSelected = () => { onNotes(track.notes.filter(n => !selIds.has(n.id))); setSelected(new Set()); };

  function copySelection() {
    const clip = drumClip(track.notes, selIds, project.beatsPerBar);
    if (!clip) return;
    clipboard.current = { clip, next: clip.anchor + clip.length };
    flash(`Copied ${clip.notes.length} ${clip.notes.length === 1 ? 'hit' : 'hits'}. Press Ctrl+V or Paste to add them.`);
  }

  function pasteAt(c: { clip: Clip; next: number }) {
    const { added } = pasteClip(c.clip, c.next, total, () => uid('n'));
    if (added.length === 0) { flash('There is no room left in the song. Choose a longer song with Length at the top.'); return false; }
    const fresh = withoutDuplicates(visible, added);
    if (fresh.length === 0) { flash('Those hits are already there.'); return false; }
    onNotes([...track.notes, ...fresh]);
    setSelected(new Set(fresh.map(n => n.id)));
    c.next += c.clip.length; // pasting again lands right after this copy
    return true;
  }
  function pasteSelection() { if (clipboard.current) pasteAt(clipboard.current); }

  /** Copies the selection and places it right after itself, so a bar of drums repeats onto the next bar. */
  function repeatSelection() {
    const clip = drumClip(track.notes, selIds, project.beatsPerBar);
    if (!clip) return;
    const c = { clip, next: clip.anchor + clip.length };
    if (pasteAt(c)) clipboard.current = c;
  }

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === 'a') { e.preventDefault(); selectAll(); return; }
      if (mod && k === 'v') { e.preventDefault(); pasteSelection(); return; }
      if (selIds.size === 0) return;
      if (mod && k === 'c') { e.preventDefault(); copySelection(); return; }
      if (mod && k === 'd') { e.preventDefault(); repeatSelection(); return; }
      if (mod) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); return; }
      if (e.key === 'Escape') { if (!document.querySelector('.popover-panel')) setSelected(new Set()); return; } // Esc closes an open menu first
      const beat = STEPS_PER_BEAT;
      if (e.key === 'ArrowLeft') { e.preventDefault(); nudge(e.shiftKey ? -beat : -1, 0); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nudge(e.shiftKey ? beat : 1, 0); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(0, 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function fillPattern(index: number) {
    const pattern = DRUM_PATTERNS[index];
    const perBar = stepsPerBar(project.beatsPerBar);
    const notes: Note[] = [];
    for (let bar = 0; bar < project.bars; bar++)
      for (const [pitch, list] of Object.entries(pattern.steps))
        for (const s of list) if (s < perBar) notes.push({ id: uid('n'), pitch: +pitch, start: (bar * perBar + s) * STEP, duration: STEP });
    setSelected(new Set());
    onNotes(notes);
  }

  return (
    <section className="roll" style={{ ['--c' as string]: track.color }}>
      <div className="roll-bar">
        <Segmented label="Tool" value={tool} onChange={setTool}
          options={[
            { value: 'draw', label: <><Icon name="pencil" size={15} /><span className="lbl">Draw</span></>, title: 'Click or drag across squares to add and remove hits', name: 'Draw' },
            { value: 'select', label: <><Icon name="select" size={15} /><span className="lbl">Select</span></>, title: 'Drag a box around hits to select them, or drag a selected hit to move it (or hold Shift in Draw mode)', name: 'Select' },
          ]} />
        <Popover buttonClass="btn small" title="Fill the whole song with a ready-made beat" trigger={<><Icon name="drum" size={15} /><span className="lbl">Start from a beat</span><Icon name="chevron" size={14} /></>}>
          {close => (
            <div role="menu">
              <div className="menu-title">Replaces what is on this track</div>
              {DRUM_PATTERNS.map((p, i) => (
                <button key={p.label} role="menuitem" className="menu-item two-line" onClick={() => { fillPattern(i); close(); }}>
                  <span className="menu-label"><strong>{p.label}</strong><small>{p.hint}</small></span>
                </button>
              ))}
            </div>
          )}
        </Popover>
        <span className="spacer" />
        <ZoomControls tz={tz} />
      </div>
      <div className="roll-main">
        <div className="roll-scroll" ref={scrollRef}>
          <div className="roll-inner" style={{ width: LABEL_W + steps * STEP_W }}>
            <Ruler total={total} beatsPerBar={project.beatsPerBar} beatW={BEAT_W} leftW={LABEL_W} height={RULER_H} grid={0.25}
              startBeat={startBeat} playing={playing} playhead={playhead} loop={loop} loopOn={loopOn} onSeek={onSeek} onLoop={onLoop} />
            <div className="roll-body">
              <div className="drum-labels" style={{ width: LABEL_W }}>
                {DRUM_ROWS.map(r => (
                  <button key={r.pitch} className="drum-label" style={{ height: ROW_H }} onMouseDown={() => engine.preview(track, r.pitch, 0.4)} title={`Hear ${r.name}`}>{r.name}</button>
                ))}
              </div>
              <div className={'drum-grid' + (tool === 'select' ? ' select-tool' : '')} style={{ width: steps * STEP_W, height: DRUM_ROWS.length * ROW_H, ['--step-w' as string]: `${STEP_W}px`, ['--beat-w' as string]: `${BEAT_W}px` }}
                onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
                {DRUM_ROWS.map(r => <div key={r.pitch} className="drum-row" style={{ height: ROW_H }} />)}
                {Array.from({ length: Math.ceil(total / project.beatsPerBar) }, (_, b) => (
                  <div key={b} className="beat-line bar" style={{ left: b * project.beatsPerBar * BEAT_W }} />
                ))}
                {visible.map(n => (
                  <div key={n.id} className={'drum-hit' + (selIds.has(n.id) ? ' selected' : '')}
                    style={{ left: stepOf(n) * STEP_W + 1.5, top: rowIndex(n.pitch) * ROW_H + 3, width: STEP_W - 3, height: ROW_H - 6 }} />
                ))}
                {marquee && <div className="marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />}
                {loop && <div className={'loop-wash' + (loopOn ? '' : ' off')} style={{ left: loop.start * BEAT_W, width: (loop.end - loop.start) * BEAT_W }} />}
                {!playing && startBeat > 0 && <div className="start-line" style={{ left: startBeat * BEAT_W }} />}
                {playing && <div className="playhead" style={{ left: playhead * BEAT_W }} />}
              </div>
            </div>
          </div>
        </div>
        {message && <div className="roll-toast" role="status">{message}</div>}
        {visible.length === 0 && (
          <div className="empty-hint" aria-hidden="true">
            <Icon name="drum" size={22} />
            <strong>Click a square to add a drum hit</strong>
            <span>Or pick “Start from a beat” for a ready-made groove.</span>
          </div>
        )}
      </div>
      <div className="sel-dock" role="toolbar" aria-label="Selected hits">
        {selIds.size > 0 ? (
          <>
            <span className="sel-count">{selIds.size} selected</span>
            <span className="sel-group">
              <button className="btn-icon" onClick={() => nudge(-1, 0)} title="Move earlier (←)" aria-label="Move earlier"><Icon name="left" /></button>
              <button className="btn-icon" onClick={() => nudge(1, 0)} title="Move later (→)" aria-label="Move later"><Icon name="right" /></button>
            </span>
            <span className="sel-group">
              <button className="btn-icon" onClick={() => nudge(0, -1)} title="Move to the drum above (↑)" aria-label="Move up a drum"><Icon name="up" /></button>
              <button className="btn-icon" onClick={() => nudge(0, 1)} title="Move to the drum below (↓)" aria-label="Move down a drum"><Icon name="down" /></button>
            </span>
            <span className="sel-group">
              <button className="btn-icon" onClick={repeatSelection} title="Copy these hits and place the copy right after them (Ctrl+D)" aria-label="Repeat"><Icon name="repeat" /></button>
              <button className="btn-icon" onClick={copySelection} title="Copy (Ctrl+C)" aria-label="Copy"><Icon name="copy" /></button>
              {clipboard.current && <button className="btn-icon" onClick={pasteSelection} title="Paste (Ctrl+V). Each paste lands after the previous one." aria-label="Paste"><Icon name="paste" /></button>}
            </span>
            <button className="btn-icon danger-icon" onClick={removeSelected} title="Remove (Delete)" aria-label="Remove"><Icon name="trash" /></button>
            <button className="btn-icon" onClick={() => setSelected(new Set())} title="Deselect (Esc)" aria-label="Deselect"><Icon name="x" /></button>
          </>
        ) : (
          <div className="dock-hints">
            <span className="hint-pointer"><kbd>Click</kbd> add or remove a hit</span>
            <span className="hint-pointer"><kbd>Drag</kbd> paint a row</span>
            <span className="hint-pointer"><kbd>Shift</kbd>+drag select several</span>
            <span className="hint-pointer"><kbd>Ctrl</kbd>+<kbd>C</kbd> <kbd>V</kbd> <kbd>D</kbd> copy, paste, repeat</span>
            <span className="hint-pointer"><kbd>Space</kbd> play</span>
            <span className="hint-touch">Tap squares to add hits. Switch to Select to pick and move them.</span>
            {clipboard.current && <button className="btn-text" onClick={pasteSelection}>Paste</button>}
            {tool === 'select' && <button className="btn-text" onClick={selectAll} disabled={visible.length === 0}>Select all</button>}
          </div>
        )}
      </div>
    </section>
  );
}
