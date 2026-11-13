import type { Macros, Track } from '../music/types';
import { MACRO_INFO } from '../audio/macros';

export function TrackPanel({ track, onMacro, onVolume, onMute, onRename, onClear, onRemove, canRemove }: {
  track: Track;
  onMacro: (k: keyof Macros, v: number) => void;
  onVolume: (v: number) => void;
  onMute: (m: boolean) => void;
  onRename: (n: string) => void;
  onClear: () => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <aside className="panel">
      <input className="name" value={track.name} onChange={e => onRename(e.target.value)} />
      <h3>Shape the sound</h3>
      {(Object.keys(MACRO_INFO) as (keyof Macros)[]).map(k => {
        const info = MACRO_INFO[k];
        return (
          <div className="macro" key={k} title={info.hint}>
            <div className="macro-head"><strong>{info.label}</strong><span>{track.macros[k]}/10</span></div>
            <input type="range" min={0} max={10} step={0.5} value={track.macros[k]} onChange={e => onMacro(k, +e.target.value)} />
            <div className="macro-ends"><span>{info.low}</span><span>{info.high}</span></div>
          </div>
        );
      })}
      <div className="macro">
        <div className="macro-head"><strong>Loudness</strong><span>{Math.round(track.volume * 10)}/10</span></div>
        <input type="range" min={0} max={1} step={0.05} value={track.volume} onChange={e => onVolume(+e.target.value)} />
      </div>
      <div className="row-btns">
        <button onClick={() => onMute(!track.muted)}>{track.muted ? '🔇 Muted' : '🔊 Mute'}</button>
        <button onClick={onClear}>Clear notes</button>
        {canRemove && <button onClick={onRemove}>Delete track</button>}
      </div>
    </aside>
  );
}
