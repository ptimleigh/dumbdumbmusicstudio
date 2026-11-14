import { useRef } from 'react';
import type { Macros, Track } from '../music/types';
import { DEFAULT_VOICE, VOICES, VOICE_IDS, type VoiceId } from '../audio/instrument';
import { MACRO_INFO } from '../audio/macros';

export function TrackPanel({ track, onVoice, loading, error, onLoadFile, onPreset, onBuiltIn, onMacro, onVolume, onMute, onRename, onClear, onRemove, canRemove }: {
  track: Track;
  onVoice: (v: VoiceId) => void;
  loading: boolean;
  error: string | null;
  onLoadFile: (f: File) => void;
  onPreset: (i: number) => void;
  onBuiltIn: () => void;
  onMacro: (k: keyof Macros, v: number) => void;
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
