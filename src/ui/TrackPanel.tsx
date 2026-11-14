import { useRef } from 'react';
import type { Macros, Track } from '../music/types';
import { DEFAULT_VOICE, VOICES, VOICE_IDS, type VoiceId } from '../audio/instrument';
import { MACRO_INFO, VIBES, matchingVibe } from '../audio/macros';

export function TrackPanel({ track, onVoice, loading, error, onLoadFile, onPreset, onBuiltIn, onMacro, onVibe, onPan, onCompare, onVolume, onMute, onRename, onClear, onRemove, canRemove }: {
  track: Track;
  onVoice: (v: VoiceId) => void;
  loading: boolean;
  error: string | null;
  onLoadFile: (f: File) => void;
  onPreset: (i: number) => void;
  onBuiltIn: () => void;
  onMacro: (k: keyof Macros, v: number) => void;
  onVibe: (m: Macros) => void;
  onPan: (v: number) => void;
  onCompare: (on: boolean) => void;
  onVolume: (v: number) => void;
  onMute: (m: boolean) => void;
  onRename: (n: string) => void;
  onClear: () => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const sf = track.sound.kind === 'soundfont' ? track.sound : null;
  return (
    <aside className="panel">
      <input className="name" value={track.name} onChange={e => onRename(e.target.value)} />
      <h3>Instrument</h3>
      <div className="instrument">
        {sf ? (
          <>
            <select value={sf.selected} onChange={e => onPreset(+e.target.value)} aria-label="Instrument">
              {sf.presets.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
            </select>
            <div className="file-name" title={sf.fileName}>{sf.fileName}</div>
          </>
        ) : (
          track.role === 'drums'
            ? <div className="file-name">Built-in drums</div>
            : (
              <label className="voice">
                <span className="file-name">Sound</span>
                <select value={track.voice ?? DEFAULT_VOICE[track.role]} onChange={e => onVoice(e.target.value as VoiceId)}>
                  {VOICE_IDS.map(v => <option key={v} value={v}>{VOICES[v].label}</option>)}
                </select>
              </label>
            )
        )}
        <div className="row-btns">
          <button disabled={loading} onClick={() => fileRef.current?.click()}>
            {loading ? 'Loading…' : sf ? 'Load another SoundFont' : track.role === 'drums' ? 'Load a drum kit (SoundFont)' : 'Load a SoundFont'}
          </button>
          {sf && <button onClick={onBuiltIn}>Use built-in</button>}
        </div>
        {!sf && <div className="file-name wrap">A SoundFont is a free pack of real instrument sounds (a .sf2 file). Search for “free GM SoundFont” to find one.</div>}
        {error && <div className="error">{error}</div>}
        <input ref={fileRef} type="file" accept=".sf2,.sf3,.dls" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) onLoadFile(f); e.target.value = ''; }} />
      </div>
      <h3>Shape the sound</h3>
      <div className="vibes" role="group" aria-label="Sound styles">
        {VIBES.map(v => (
          <button key={v.id} className={'chip' + (matchingVibe(track.macros)?.id === v.id ? ' on' : '')} title={v.hint} onClick={() => onVibe(v.macros)}>{v.label}</button>
        ))}
      </div>
      {(Object.keys(MACRO_INFO) as (keyof Macros)[]).map(k => {
        const info = MACRO_INFO[k];
        return (
          <div className="macro" key={k} title={info.hint}>
            <div className="macro-head">
              <strong>{info.label}</strong>
              <span>{track.macros[k]}/10 {track.macros[k] !== 5 && <button className="reset" onClick={() => onMacro(k, 5)} title="Put this back to 5" aria-label={`Reset ${info.label}`}>↺</button>}</span>
            </div>
            <input type="range" min={0} max={10} step={0.5} value={track.macros[k]} aria-label={info.label}
              onChange={e => onMacro(k, +e.target.value)} onDoubleClick={() => onMacro(k, 5)} />
            <div className="macro-ends"><span>{info.low}</span><span>{info.high}</span></div>
          </div>
        );
      })}
      <button className="compare" title="Press and hold to hear this track with all the Warmth, Punch and Space effects switched off"
        onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); onCompare(true); }}
        onPointerUp={() => onCompare(false)} onPointerCancel={() => onCompare(false)}
        onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); onCompare(true); } }}
        onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') onCompare(false); }}>
        Hold to hear it without effects
      </button>
      <div className="macro">
        <div className="macro-head"><strong>Loudness</strong><span>{Math.round(track.volume * 10)}/10</span></div>
        <input type="range" min={0} max={1} step={0.05} value={track.volume} aria-label="Loudness" onChange={e => onVolume(+e.target.value)} />
      </div>
      <div className="macro">
        <div className="macro-head">
          <strong>Position</strong>
          <span>{(track.pan ?? 0) === 0 ? 'Center' : `${(track.pan ?? 0) < 0 ? 'Left' : 'Right'} ${Math.abs(Math.round((track.pan ?? 0) * 10))}`} {(track.pan ?? 0) !== 0 && <button className="reset" onClick={() => onPan(0)} title="Back to the center" aria-label="Reset position">↺</button>}</span>
        </div>
        <input type="range" min={-1} max={1} step={0.1} value={track.pan ?? 0} aria-label="Position, left to right" onChange={e => onPan(+e.target.value)} onDoubleClick={() => onPan(0)} />
        <div className="macro-ends"><span>Left speaker</span><span>Right speaker</span></div>
      </div>
      <div className="row-btns">
        <button onClick={() => onMute(!track.muted)}>{track.muted ? '🔇 Muted' : '🔊 Mute'}</button>
        <button onClick={onClear}>Clear notes</button>
        {canRemove && <button onClick={onRemove}>Delete track</button>}
      </div>
    </aside>
  );
}
