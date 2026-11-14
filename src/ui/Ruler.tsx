import { useRef, useState } from 'react';
import type { Region } from '../audio/transport';
import { normalizeRegion, snapBeat } from '../audio/transport';

/**
 * The bar ruler above a grid. Click it to choose where playback starts; drag across it to mark a section to loop.
 */
export function Ruler({ total, beatsPerBar, beatW, leftW, height, grid, startBeat, playing, playhead, loop, loopOn, onSeek, onLoop }: {
  total: number; beatsPerBar: number; beatW: number; leftW: number; height: number;
  grid: number;                 // snap step, in beats
  startBeat: number; playing: boolean; playhead: number;
  loop: Region | null; loopOn: boolean;
  onSeek: (beat: number) => void; onLoop: (r: Region | null) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Region | null>(null);
  const drag = useRef<{ kind: 'new' | 'start' | 'end'; x0: number; anchor: number; moved: boolean; fixed: Region | null } | null>(null);

  const beatAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect();
    return snapBeat((clientX - r.left) / beatW, grid, total);
  };

  function down(e: React.PointerEvent<HTMLDivElement>, kind: 'new' | 'start' | 'end') {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, x0: e.clientX, anchor: beatAt(e.clientX), moved: false, fixed: loop };
  }
  function move(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.x0) > 5) d.moved = true;
    if (!d.moved) return;
    const b = beatAt(e.clientX);
    if (d.kind === 'new') setDraft({ start: Math.min(d.anchor, b), end: Math.max(d.anchor, b) });
    else if (d.fixed) setDraft(d.kind === 'start' ? { start: b, end: d.fixed.end } : { start: d.fixed.start, end: b });
  }
  function up(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.moved && draft) onLoop(normalizeRegion(draft, total));
    else if (!d.moved && d.kind === 'new') onSeek(beatAt(e.clientX));
    setDraft(null);
  }

  const region = draft ?? loop;
  const bar = (b: number) => b % beatsPerBar === 0;
  return (
    <div className="ruler" style={{ height }}>
      <div className="corner" style={{ width: leftW }} />
      <div className="ruler-track" ref={trackRef} style={{ width: total * beatW }}
        title="Click to start playing from here. Drag to loop a section."
        onPointerDown={e => down(e, 'new')} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {grid * beatW >= 8 && <div className="snap-ticks" style={{ ['--snap-w' as string]: `${grid * beatW}px` }} />}
        {Array.from({ length: total }, (_, b) => {
          const label = bar(b) ? String(b / beatsPerBar + 1) : beatW >= 64 ? `${(b / beatsPerBar | 0) + 1}.${(b % beatsPerBar) + 1}` : '';
          return <div key={b} className={'tick' + (bar(b) ? ' bar' : '')} style={{ left: b * beatW }}>{label && <span className={bar(b) ? '' : 'sub'}>{label}</span>}</div>;
        })}
        {region && (
          <div className={'loop-band' + (loopOn ? '' : ' off')} style={{ left: region.start * beatW, width: Math.max(2, (region.end - region.start) * beatW) }}>
            <div className="loop-handle left" onPointerDown={e => down(e, 'start')} onPointerMove={move} onPointerUp={up} onPointerCancel={up} title="Drag to change where the loop starts" />
            <div className="loop-handle right" onPointerDown={e => down(e, 'end')} onPointerMove={move} onPointerUp={up} onPointerCancel={up} title="Drag to change where the loop ends" />
            {!draft && (
              <button className="loop-clear" aria-label="Clear the loop section" title="Clear the loop section"
                onPointerDown={e => e.stopPropagation()} onClick={() => onLoop(null)}>×</button>
            )}
          </div>
        )}
        {!playing && <div className="start-flag" style={{ left: startBeat * beatW }} title="Playback starts here" />}
        {playing && <div className="ruler-head" style={{ left: playhead * beatW }} />}
      </div>
    </div>
  );
}
