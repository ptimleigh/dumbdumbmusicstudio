import { useEffect, useRef, useState } from 'react';
import type { Macros, Project, Role } from '../music/types';
import { newProject, newTrack, ROLE_LABELS } from '../music/project';
import { NOTE_NAMES, SCALE_LABELS } from '../music/theory';
import { engine } from '../audio/engine';
import { PianoRoll } from './PianoRoll';
import { TrackPanel } from './TrackPanel';

export function App() {
  const [project, setProject] = useState<Project>(newProject);
  const [activeId, setActiveId] = useState(project.tracks[0].id);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [sfError, setSfError] = useState<string | null>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  engine.getProject = () => projectRef.current;

  const track = project.tracks.find(t => t.id === activeId) ?? project.tracks[0];

  useEffect(() => {
    let raf = 0;
    const loop = () => { setPlayhead(engine.position()); raf = requestAnimationFrame(loop); };
    if (playing) raf = requestAnimationFrame(loop); else setPlayhead(0);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'SELECT' && (e.target as HTMLElement).tagName !== 'INPUT') {
        e.preventDefault(); togglePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function togglePlay() {
    if (engine.playing) { engine.stop(); setPlaying(false); }
    else { await engine.play(); setPlaying(true); }
  }

  const patch = (p: Partial<Project>) => setProject(prev => ({ ...prev, ...p }));
  const patchTrack = (id: string, f: (t: Project['tracks'][number]) => Project['tracks'][number]) =>
    setProject(prev => ({ ...prev, tracks: prev.tracks.map(t => (t.id === id ? f(t) : t)) }));

  async function loadSoundFont(file: File) {
    const target = track;
    setLoadingId(target.id); setSfError(null);
    try {
      const presets = await engine.loadSoundFont(target, await file.arrayBuffer());
      patchTrack(target.id, t => ({ ...t, sound: { kind: 'soundfont', fileName: file.name, presets, selected: 0 } }));
    } catch (e) {
      setSfError(e instanceof Error ? e.message : 'Could not read that file. Try a .sf2, .sf3 or .dls SoundFont.');
    } finally { setLoadingId(null); }
  }
  const choosePreset = (i: number) => {
    if (track.sound.kind !== 'soundfont') return;
    engine.selectPreset(track, track.sound.presets[i]);
    patchTrack(track.id, t => t.sound.kind === 'soundfont' ? { ...t, sound: { ...t.sound, selected: i } } : t);
  };
  const useBuiltIn = () => { engine.useBuiltInSound(track); patchTrack(track.id, t => ({ ...t, sound: { kind: 'synth' } })); };

  const addTrack = (role: Role) => {
    const t = newTrack(role);
    setProject(prev => ({ ...prev, tracks: [...prev.tracks, t] }));
    setActiveId(t.id);
  };
  const removeTrack = (id: string) => {
    if (project.tracks.length === 1) return;
    engine.dispose(id);
    const rest = project.tracks.filter(t => t.id !== id);
    setProject({ ...project, tracks: rest });
    if (activeId === id) setActiveId(rest[0].id);
  };

  return (
    <div className="app">
      <header className="topbar">
        <h1>🎹 Dumb Dumb Music Studio</h1>
        <button className="play" onClick={togglePlay}>{playing ? '■ Stop' : '▶ Play'}</button>
        <label>Speed
          <input type="range" min={60} max={180} value={project.tempo} onChange={e => patch({ tempo: +e.target.value })} />
          <span>{project.tempo} bpm</span>
        </label>
        <label>Key
          <select value={project.key} onChange={e => patch({ key: +e.target.value })}>
            {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
        </label>
        <label>Mood
          <select value={project.scaleName} onChange={e => patch({ scaleName: e.target.value as Project['scaleName'] })}>
            {Object.entries(SCALE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>Length
          <select value={project.bars} onChange={e => patch({ bars: +e.target.value })}>
            {[2, 4, 8, 16].map(b => <option key={b} value={b}>{b} bars</option>)}
          </select>
        </label>
      </header>

      <div className="tracks">
        {project.tracks.map(t => (
          <button key={t.id} className={'track-tab' + (t.id === track.id ? ' active' : '')}
            style={{ borderColor: t.color }} onClick={() => { setActiveId(t.id); setSfError(null); }}>
            <span className="dot" style={{ background: t.color }} />{t.name}
          </button>
        ))}
        <select className="add-track" value="" onChange={e => e.target.value && addTrack(e.target.value as Role)}>
          <option value="">+ Add track…</option>
          {(Object.keys(ROLE_LABELS) as Role[]).map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </div>

      <main className="workspace">
        <PianoRoll
          project={project}
          track={track}
          playhead={playhead}
          onNotes={notes => patchTrack(track.id, t => ({ ...t, notes }))}
        />
        <TrackPanel
          track={track}
          loading={loadingId === track.id}
          error={sfError}
          onLoadFile={loadSoundFont}
          onPreset={choosePreset}
          onBuiltIn={useBuiltIn}
          onMacro={(k: keyof Macros, v: number) => { patchTrack(track.id, t => ({ ...t, macros: { ...t.macros, [k]: v } })); }}
          onVolume={v => patchTrack(track.id, t => ({ ...t, volume: v }))}
          onMute={m => patchTrack(track.id, t => ({ ...t, muted: m }))}
          onRename={name => patchTrack(track.id, t => ({ ...t, name }))}
          onClear={() => patchTrack(track.id, t => ({ ...t, notes: [] }))}
          onRemove={() => removeTrack(track.id)}
          canRemove={project.tracks.length > 1}
        />
      </main>
    </div>
  );
}
