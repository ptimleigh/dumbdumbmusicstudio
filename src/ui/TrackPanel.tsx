import { useRef } from 'react';
import type { Macros, Track } from '../music/types';
import { DEFAULT_VOICE, VOICES, VOICE_IDS, type VoiceId } from '../audio/instrument';
import { MACRO_INFO, VIBES, matchingVibe } from '../audio/macros';
import { Icon, Slider } from './kit';
import { ROLE_LABELS } from '../music/project';

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
  const pan = track.pan ?? 0;
  const vibe = matchingVibe(track.macros);

  return (
    <aside className="panel" style={{ ['--c' as string]: track.color }} aria-label={`${track.name} settings`}>
      <div className="panel-head">
        <span className="panel-dot" aria-hidden="true" />
        <input className="panel-name" aria-label="Track name" value={track.name} onChange={e => onRename(e.target.value)} />
        <span className="role-tag">{ROLE_LABELS[track.role]}</span>
      </div>

      <details className="section" open>
        <summary>Instrument<Icon name="chevron" size={16} /></summary>
        <div className="section-body">
          {sf ? (
            <>
              <select value={sf.selected} onChange={e => onPreset(+e.target.value)} aria-label="Instrument">
                {sf.presets.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
              </select>
              <div className="file-chip" title={sf.fileName}><Icon name="note" size={14} /><span>{sf.fileName}</span></div>
            </>
          ) : track.role === 'drums' ? (
            <div className="file-chip"><Icon name="drum" size={14} /><span>Built-in drums</span></div>
          ) : (
            <label className="stack"><span className="muted small">Sound</span>
              <select value={track.voice ?? DEFAULT_VOICE[track.role]} onChange={e => onVoice(e.target.value as VoiceId)} aria-label="Sound">
                {VOICE_IDS.map(v => <option key={v} value={v}>{VOICES[v].label}</option>)}
              </select>
            </label>
          )}
          <div className="row-gap">
            <button className="btn small" disabled={loading} onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={15} />{loading ? 'Loading…' : sf ? 'Load another SoundFont' : track.role === 'drums' ? 'Load a drum kit (SoundFont)' : 'Load a SoundFont'}
            </button>
            {sf && <button className="btn small" onClick={onBuiltIn}>Use built-in</button>}
          </div>
          {!sf && <p className="hint-text">A SoundFont is a free pack of real instrument sounds (a .sf2 file). Search for “free GM SoundFont” to find one.</p>}
          {error && <div className="error-text">{error}</div>}
          <input ref={fileRef} type="file" accept=".sf2,.sf3,.dls" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onLoadFile(f); e.target.value = ''; }} />
        </div>
      </details>

      <details className="section" open>
        <summary>Shape the sound<Icon name="chevron" size={16} /></summary>
        <div className="section-body">
          <div className="vibes" role="group" aria-label="Sound styles">
            {VIBES.map(v => (
              <button key={v.id} className={'pill' + (vibe?.id === v.id ? ' on' : '')} title={v.hint} aria-pressed={vibe?.id === v.id} onClick={() => onVibe(v.macros)}>{v.label}</button>
            ))}
          </div>
          {(Object.keys(MACRO_INFO) as (keyof Macros)[]).map(k => {
            const info = MACRO_INFO[k];
            return (
              <div className="control" key={k} title={info.hint}>
                <div className="control-head">
                  <strong>{info.label}</strong>
                  <span className="value">{track.macros[k]}<small>/10</small>
                    {track.macros[k] !== 5 && <button className="reset" onClick={() => onMacro(k, 5)} title="Put this back to 5" aria-label={`Reset ${info.label}`}>↺</button>}
                  </span>
                </div>
                <Slider min={0} max={10} step={0.5} value={track.macros[k]} label={info.label} onChange={v => onMacro(k, v)} onDoubleClick={() => onMacro(k, 5)} />
                <div className="control-ends"><span>{info.low}</span><span>{info.high}</span></div>
              </div>
            );
          })}
          <button className="btn compare" title="Press and hold to hear this track with all the Warmth, Punch and Space effects switched off"
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); onCompare(true); }}
            onPointerUp={() => onCompare(false)} onPointerCancel={() => onCompare(false)}
            onKeyDown={e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); onCompare(true); } }}
            onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') onCompare(false); }}>
            <Icon name="eye" size={16} />Hold to hear it without effects
          </button>
        </div>
      </details>

      <details className="section" open>
        <summary>Mix<Icon name="chevron" size={16} /></summary>
        <div className="section-body">
          <div className="control">
            <div className="control-head"><strong>Loudness</strong><span className="value">{Math.round(track.volume * 10)}<small>/10</small></span></div>
            <Slider min={0} max={1} step={0.05} value={track.volume} label="Loudness" onChange={onVolume} />
          </div>
          <div className="control">
            <div className="control-head">
              <strong>Position</strong>
              <span className="value">{pan === 0 ? 'Center' : `${pan < 0 ? 'Left' : 'Right'} ${Math.abs(Math.round(pan * 10))}`}
                {pan !== 0 && <button className="reset" onClick={() => onPan(0)} title="Back to the center" aria-label="Reset position">↺</button>}
              </span>
            </div>
            <Slider min={-1} max={1} step={0.1} value={pan} label="Position, left to right" onChange={onPan} onDoubleClick={() => onPan(0)} />
            <div className="control-ends"><span>Left speaker</span><span>Right speaker</span></div>
          </div>
          <div className="row-gap">
            <button className={'btn small' + (track.muted ? ' on' : '')} aria-pressed={track.muted} onClick={() => onMute(!track.muted)}>
              <Icon name={track.muted ? 'mute' : 'volume'} size={15} />{track.muted ? 'Muted' : 'Mute'}
            </button>
          </div>
        </div>
      </details>

      <details className="section">
        <summary>Track<Icon name="chevron" size={16} /></summary>
        <div className="section-body">
          <div className="row-gap">
            <button className="btn small" onClick={onClear} disabled={track.notes.length === 0}>Clear notes</button>
            {canRemove && <button className="btn small danger" onClick={onRemove}><Icon name="trash" size={15} />Delete track</button>}
          </div>
        </div>
      </details>
    </aside>
  );
}
