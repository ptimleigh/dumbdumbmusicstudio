import { useEffect, useRef, useState } from 'react';
import type { Macros, Project, Role } from '../music/types';
import { newProject, newTrack, ROLE_LABELS } from '../music/project';
import { NOTE_NAMES, SCALE_LABELS } from '../music/theory';
import { fileNameFor, parseProject, serializeProject } from '../music/serialize';
import { clearAutosave, getSoundFont, loadAutosave, putSoundFont, saveAutosave } from '../storage';
import { engine } from '../audio/engine';
import { PianoRoll } from './PianoRoll';
import { TrackPanel } from './TrackPanel';

export function App() {
  const [project, setProject] = useState<Project>(() => loadAutosave() ?? newProject());
  const [activeId, setActiveId] = useState(project.tracks[0].id);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [sfError, setSfError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [confirmNew, setConfirmNew] = useState(false);
  const openRef = useRef<HTMLInputElement>(null);
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

  // autosave shortly after every change
  useEffect(() => {
    const t = window.setTimeout(() => saveAutosave(project), 400);
    return () => clearTimeout(t);
  }, [project]);

  // bring back the SoundFonts the autosaved project was using
  useEffect(() => { void restoreSoundFonts(projectRef.current); }, []);

  async function restoreSoundFonts(p: Project) {
    const problems: string[] = [];
    for (const t of p.tracks) {
      if (t.sound.kind !== 'soundfont') continue;
      const { fileName, selected } = t.sound;
      const data = await getSoundFont(fileName);
      try {
        if (!data) throw new Error('missing');
        const presets = await engine.loadSoundFont(t, data);
        const sel = Math.min(selected, presets.length - 1);
        engine.selectPreset(t, presets[sel]);
        patchTrack(t.id, x => ({ ...x, sound: { kind: 'soundfont', fileName, presets, selected: sel } }));
      } catch {
        problems.push(`"${t.name}" used the SoundFont "${fileName}", which isn't on this computer yet. It is playing with the built-in sound until you pick that track and load the file.`);
        engine.useBuiltInSound(t);
        patchTrack(t.id, x => ({ ...x, sound: { kind: 'synth' } }));
      }
    }
    setNotices(problems);
  }

  function openProject(p: Project) {
    engine.stop(); setPlaying(false);
    engine.resetAll();
    setProject(p);
    projectRef.current = p;
    setActiveId(p.tracks[0].id);
    setSfError(null);
    void restoreSoundFonts(p);
  }

  async function onOpenFile(file: File) {
    try { openProject(parseProject(await file.text())); }
    catch (e) { setNotices([e instanceof Error ? e.message : 'Could not open that file.']); }
  }

  function saveToFile() {
    const url = URL.createObjectURL(new Blob([serializeProject(project)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = fileNameFor(project);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function newSong() {
    if (!confirmNew) { setConfirmNew(true); window.setTimeout(() => setConfirmNew(false), 4000); return; }
    setConfirmNew(false);
    clearAutosave();
    openProject(newProject());
    setNotices([]);
  }

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
      const data = await file.arrayBuffer();
      const presets = await engine.loadSoundFont(target, data);
      void putSoundFont(file.name, data);
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
        <input className="song-name" aria-label="Song name" value={project.name} onChange={e => patch({ name: e.target.value })} />
        <button onClick={saveToFile} title="Download this song as a file">Save</button>
        <button onClick={() => openRef.current?.click()} title="Open a saved song file">Open</button>
        <button onClick={newSong}>{confirmNew ? 'Click again to start over' : 'New'}</button>
        <input ref={openRef} type="file" accept=".json,application/json" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) void onOpenFile(f); e.target.value = ''; }} />
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

      {notices.length > 0 && (
        <div className="notices" role="status">
          {notices.map((n, i) => <p key={i}>{n}</p>)}
          <button onClick={() => setNotices([])}>Dismiss</button>
        </div>
      )}

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
