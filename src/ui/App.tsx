import { useEffect, useRef, useState } from 'react';
import type { Macros, Project, Role, Track } from '../music/types';
import { change, initHistory, redo as redoHistory, undo as undoHistory } from '../music/history';
import { exampleProject, newProject, newTrack, ROLE_LABELS } from '../music/project';
import { NOTE_NAMES, SCALE_LABELS } from '../music/theory';
import { fileNameFor, parseProject, serializeProject } from '../music/serialize';
import { clearAutosave, getSoundFont, loadAutosave, putSoundFont, saveAutosave } from '../storage';
import { engine } from '../audio/engine';
import { PianoRoll } from './PianoRoll';
import { DrumGrid } from './DrumGrid';
import { ExportDialog } from './ExportDialog';
import { Welcome } from './Welcome';
import { ShortcutsDialog } from './ShortcutsDialog';
import { Icon, LogoMark, MenuItem, MenuSeparator, Popover, Toasts, type Toast } from './kit';
import { useTheme } from './useTheme';
import { normalizeRegion, type Region } from '../audio/transport';
import { TrackPanel } from './TrackPanel';

export function App() {
  const [hist, setHist] = useState(() => initHistory(loadAutosave() ?? newProject()));
  const project = hist.present;
  type Opts = { key?: string; silent?: boolean };
  const setProject = (f: (p: Project) => Project, o: Opts = {}) =>
    setHist(h => change(h, f(h.present), { ...o, now: Date.now() }));
  const [activeId, setActiveId] = useState(project.tracks[0].id);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [startBeat, setStartBeat] = useState(0);            // where Play begins (set by clicking the ruler)
  const [loopOn, setLoopOn] = useState(true);               // repeat, or play once and stop
  const [loopRegion, setLoopRegion] = useState<Region | null>(null); // a marked section to loop instead of the whole song
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [sfError, setSfError] = useState<string | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [confirmNew, setConfirmNew] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toast = (text: string) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, text }]);
    window.setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  };
  const { theme, toggle: toggleTheme } = useTheme();
  const [showWelcome, setShowWelcome] = useState(() => {
    try { return localStorage.getItem('dumbdumb.welcomeSeen') !== '1'; } catch { return true; }
  });
  // after a sound change, play a short sample so the change can be heard without pressing Play
  const auditionTimer = useRef<number | undefined>(undefined);
  const scheduleAudition = (trackId: string, delay = 350) => {
    window.clearTimeout(auditionTimer.current);
    auditionTimer.current = window.setTimeout(() => { void engine.audition(projectRef.current, trackId); }, delay);
  };
  const closeWelcome = () => {
    setShowWelcome(false);
    try { localStorage.setItem('dumbdumb.welcomeSeen', '1'); } catch { /* ignore */ }
  };
  const openRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef(project);
  projectRef.current = project;
  engine.getProject = () => projectRef.current;

  const track = project.tracks.find(t => t.id === activeId) ?? project.tracks[0];

  // keep the marker and loop section inside the song if its length changes
  const total = project.bars * project.beatsPerBar;
  const region = normalizeRegion(loopRegion, total);
  const start = Math.min(startBeat, total);
  const activeLoop: Region | null = loopOn ? (region ?? { start: 0, end: total }) : null;
  // Play reads these, so it always uses the latest choice even right after a click
  const startRef = useRef(start); startRef.current = start;
  const loopRef = useRef(activeLoop); loopRef.current = activeLoop;

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setPlayhead(engine.position());
      if (!engine.playing) { setPlaying(false); return; } // the song reached its end (when not looping)
      raf = requestAnimationFrame(loop);
    };
    if (playing) raf = requestAnimationFrame(loop); else setPlayhead(0);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // changing the loop while playing takes effect straight away
  useEffect(() => { if (engine.playing) engine.setLoop(activeLoop); }, [loopOn, region?.start, region?.end, total]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === '?' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') { e.preventDefault(); setShowShortcuts(v => !v); return; }
      const typing = tag === 'TEXTAREA' || (tag === 'INPUT' && (e.target as HTMLInputElement).type === 'text');
      if ((e.ctrlKey || e.metaKey) && !typing && e.code === 'KeyZ') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && !typing && e.code === 'KeyY') { e.preventDefault(); redo(); return; }
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && tag !== 'SELECT' && e.code === 'KeyL') { e.preventDefault(); setLoopOn(v => !v); return; }
      if (!typing && tag !== 'SELECT' && e.code === 'Home') { e.preventDefault(); seek(0); return; }
      if (e.code === 'Space' && !exporting && (e.target as HTMLElement).tagName !== 'SELECT' && (e.target as HTMLElement).tagName !== 'INPUT') {
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
        patchTrack(t.id, x => ({ ...x, sound: { kind: 'soundfont', fileName, presets, selected: sel } }), { silent: true });
      } catch {
        problems.push(`"${t.name}" used the SoundFont "${fileName}", which isn't on this computer yet. It is playing with the built-in sound until you pick that track and load the file.`);
        engine.useBuiltInSound(t);
        patchTrack(t.id, x => ({ ...x, sound: { kind: 'synth' } }), { silent: true });
      }
    }
    setNotices(problems);
  }

  function openProject(p: Project) {
    engine.stop(); setPlaying(false);
    setStartBeat(0); setLoopRegion(null);
    engine.resetAll();
    setHist(initHistory(p));
    projectRef.current = p;
    setActiveId(p.tracks[0].id);
    setSfError(null);
    void restoreSoundFonts(p);
  }

  async function onOpenFile(file: File) {
    try { const p = parseProject(await file.text()); openProject(p); toast(`Opened “${p.name}”`); }
    catch (e) { setNotices([e instanceof Error ? e.message : 'Could not open that file.']); }
  }

  function saveToFile() {
    const url = URL.createObjectURL(new Blob([serializeProject(project)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = fileNameFor(project);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Saved ${a.download}`);
  }

  function newSong() {
    if (!confirmNew) { setConfirmNew(true); window.setTimeout(() => setConfirmNew(false), 4000); return; }
    setConfirmNew(false);
    clearAutosave();
    openProject(newProject());
    setNotices([]);
    toast('Started a new song');
  }

  function loadExample() {
    openProject(exampleProject());
    closeWelcome();
  }

  /** Choose where playback starts; jumps there straight away if already playing. */
  function seek(beat: number) {
    startRef.current = beat;
    setStartBeat(beat);
    if (engine.playing) engine.seek(beat);
  }
  /** Mark a section of the song to loop (null clears it). */
  function markLoop(r: Region | null) {
    setLoopRegion(r);
    if (r) { setLoopOn(true); if (!engine.playing) { startRef.current = r.start; setStartBeat(r.start); } } // Play then starts at the section
  }

  async function togglePlay() {
    if (engine.playing) { engine.stop(); setPlaying(false); }
    else { await engine.play({ from: startRef.current, loop: loopRef.current }); setPlaying(true); }
  }

  const patch = (p: Partial<Project>, key?: string) => setProject(prev => ({ ...prev, ...p }), { key });
  const patchTrack = (id: string, f: (t: Track) => Track, o: Opts = {}) =>
    setProject(prev => ({ ...prev, tracks: prev.tracks.map(t => (t.id === id ? f(t) : t)) }), o);

  // Which SoundFont a track uses is tied to the audio engine, so undo never changes it.
  const keepSound = (snap: Project, cur: Project): Project => ({
    ...snap,
    tracks: snap.tracks.map(t => {
      const now = cur.tracks.find(x => x.id === t.id);
      if (now) return { ...t, sound: now.sound };
      return t.sound.kind === 'soundfont' ? { ...t, sound: { kind: 'synth' } } : t;
    }),
  });
  const undo = () => setHist(h => undoHistory(h, keepSound));
  const redo = () => setHist(h => redoHistory(h, keepSound));

  async function loadSoundFont(file: File) {
    const target = track;
    setLoadingId(target.id); setSfError(null);
    try {
      const data = await file.arrayBuffer();
      const presets = await engine.loadSoundFont(target, data);
      void putSoundFont(file.name, data);
      patchTrack(target.id, t => ({ ...t, sound: { kind: 'soundfont', fileName: file.name, presets, selected: 0 } }), { silent: true });
    } catch (e) {
      setSfError(e instanceof Error ? e.message : 'Could not read that file. Try a .sf2, .sf3 or .dls SoundFont.');
    } finally { setLoadingId(null); }
  }
  const choosePreset = (i: number) => {
    if (track.sound.kind !== 'soundfont') return;
    engine.selectPreset(track, track.sound.presets[i]);
    patchTrack(track.id, t => t.sound.kind === 'soundfont' ? { ...t, sound: { ...t.sound, selected: i } } : t, { silent: true });
  };
  const useBuiltIn = () => { engine.useBuiltInSound(track); patchTrack(track.id, t => ({ ...t, sound: { kind: 'synth' } }), { silent: true }); };

  const addTrack = (role: Role) => {
    const t = newTrack(role);
    setProject(prev => ({ ...prev, tracks: [...prev.tracks, t] }));
    setActiveId(t.id);
  };
  const removeTrack = (id: string) => {
    if (project.tracks.length === 1) return;
    engine.dispose(id);
    const rest = project.tracks.filter(t => t.id !== id);
    setProject(prev => ({ ...prev, tracks: prev.tracks.filter(t => t.id !== id) }));
    if (activeId === id) setActiveId(rest[0].id);
  };

  return (
    <div className="app">
      {exporting && <ExportDialog project={project} onClose={() => setExporting(false)} />}
      {showShortcuts && <ShortcutsDialog onClose={() => setShowShortcuts(false)} />}
      <Toasts items={toasts} />
      <header className="topbar">
        <div className="brand"><LogoMark /><span className="brand-name">Dumb Dumb <em>Studio</em></span></div>
        <input className="song-name" aria-label="Song name" value={project.name} onChange={e => patch({ name: e.target.value }, 'song-name')} />

        <div className="transport" role="group" aria-label="Playback">
          <button className="play-btn" onClick={togglePlay} aria-pressed={playing} aria-label={playing ? 'Stop' : 'Play'} title={playing ? 'Stop (Space)' : 'Play (Space)'}>
            <Icon name={playing ? 'stop' : 'play'} size={22} />
          </button>
          <button className="btn-icon loop-btn" onClick={() => setLoopOn(v => !v)} aria-pressed={loopOn} aria-label="Loop"
            title={loopOn ? (region ? 'Looping the section you marked on the ruler (L)' : 'Looping the whole song (L)') : 'Loop is off: the song plays once (L)'}>
            <Icon name="loop" size={19} />{loopOn && region && <span className="loop-dot" />}
          </button>
          <div className="stepper" role="group" aria-label="Speed">
            <button className="btn-icon" onClick={() => patch({ tempo: Math.max(60, project.tempo - 1) }, 'tempo')} aria-label="Slower" title="Slower"><Icon name="left" size={16} /></button>
            <Popover buttonClass="tempo-btn" title="Change the speed" align="center" label={`Speed ${project.tempo} beats per minute`}
              trigger={<><b>{project.tempo}</b><small>BPM</small></>}>
              <div className="popover-panel-inner pad">
                <label className="speed-slider"><span>Speed</span>
                  <input type="range" min={60} max={180} value={project.tempo} aria-label="Speed in beats per minute" onChange={e => patch({ tempo: +e.target.value }, 'tempo')} />
                </label>
              </div>
            </Popover>
            <button className="btn-icon" onClick={() => patch({ tempo: Math.min(180, project.tempo + 1) }, 'tempo')} aria-label="Faster" title="Faster"><Icon name="right" size={16} /></button>
          </div>
          <span className="divider" />
          <div className="song-fields">
            <SongFields project={project} patch={patch} />
          </div>
          <Popover buttonClass="btn-icon song-popover" align="end" title="Key, mood and length" label="Song settings" trigger={<Icon name="sliders" />}>
            <div className="popover-panel-inner pad song-popover-body"><SongFields project={project} patch={patch} /></div>
          </Popover>
        </div>

        <div className="top-actions">
          <button className="btn-icon" onClick={undo} disabled={hist.past.length === 0} title="Undo (Ctrl+Z)" aria-label="Undo"><Icon name="undo" /></button>
          <button className="btn-icon" onClick={redo} disabled={hist.future.length === 0} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Icon name="redo" /></button>
          <Popover buttonClass="btn" align="end" trigger={<><Icon name="menu" size={17} />File</>} title="Save, open and export">
            {close => (
              <div role="menu">
                <MenuItem icon="download" onClick={() => { saveToFile(); close(); }} hint="">Save song</MenuItem>
                <MenuItem icon="upload" onClick={() => { openRef.current?.click(); close(); }}>Open a song…</MenuItem>
                <MenuItem icon="wave" onClick={() => { engine.stop(); setPlaying(false); setExporting(true); close(); }}>Export as audio (WAV)…</MenuItem>
                <MenuSeparator />
                <MenuItem icon="filePlus" danger={confirmNew} onClick={() => { if (!confirmNew) { setConfirmNew(true); window.setTimeout(() => setConfirmNew(false), 4000); } else { newSong(); close(); } }}>
                  {confirmNew ? 'Click again to start over' : 'New song'}
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon="help" onClick={() => { setShowWelcome(v => !v); close(); }}>{showWelcome ? 'Hide getting-started tips' : 'Show getting-started tips'}</MenuItem>
                <MenuItem icon="keyboard" hint="?" onClick={() => { setShowShortcuts(true); close(); }}>Keyboard shortcuts</MenuItem>
                <MenuItem icon={theme === 'dark' ? 'sun' : 'moon'} onClick={() => { toggleTheme(); close(); }}>{theme === 'dark' ? 'Use the light look' : 'Use the dark look'}</MenuItem>
              </div>
            )}
          </Popover>
          <button className="btn-icon hide-sm hide-md" onClick={() => setShowShortcuts(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"><Icon name="keyboard" /></button>
          <button className="btn-icon hide-sm hide-md" onClick={() => setShowWelcome(v => !v)} aria-pressed={showWelcome} title="Show or hide the getting-started tips" aria-label="Help"><Icon name="help" /></button>
          <button className="btn-icon hide-sm hide-md" onClick={toggleTheme} title={theme === 'dark' ? 'Switch to the light look' : 'Switch to the dark look'} aria-label="Switch between light and dark"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
        </div>
        <input ref={openRef} type="file" accept=".json,application/json" hidden
          onChange={e => { const f = e.target.files?.[0]; if (f) void onOpenFile(f); e.target.value = ''; }} />
      </header>

      {showWelcome && <Welcome onExample={loadExample} onClose={closeWelcome} />}

      {notices.length > 0 && (
        <div className="notices" role="status">
          {notices.map((n, i) => <p key={i}>{n}</p>)}
          <button onClick={() => setNotices([])}>Dismiss</button>
        </div>
      )}

      <div className="tracks-bar">
      <div className="tracks" role="tablist" aria-label="Tracks">
        {project.tracks.map(t => (
          <div key={t.id} className={'track-tab' + (t.id === track.id ? ' active' : '') + (t.muted ? ' muted' : '')} style={{ ['--c' as string]: t.color }}>
            <button className="tab-main" role="tab" aria-selected={t.id === track.id} onClick={() => { setActiveId(t.id); setSfError(null); }}>
              <span className="dot" />{t.name}
            </button>
            <button className="tab-mute" aria-pressed={t.muted} aria-label={`${t.muted ? 'Unmute' : 'Mute'} ${t.name}`} title={t.muted ? 'Unmute' : 'Mute'}
              onClick={() => patchTrack(t.id, x => ({ ...x, muted: !x.muted }))}>
              <Icon name={t.muted ? 'mute' : 'volume'} size={16} />
            </button>
          </div>
        ))}
      </div>
        <Popover buttonClass="btn add-track-btn" align="end" label="Add track" trigger={<><Icon name="plus" size={16} /><span className="lbl">Add track</span></>} title="Add another track">
          {close => (
            <div role="menu">
              <div className="menu-title">Add a track</div>
              {(Object.keys(ROLE_LABELS) as Role[]).map(r => (
                <MenuItem key={r} icon={r === 'drums' ? 'drum' : 'note'} onClick={() => { addTrack(r); close(); }}>{ROLE_LABELS[r]}</MenuItem>
              ))}
            </div>
          )}
        </Popover>
      </div>

      <main className="workspace">
        {track.role === 'drums' ? (
          <DrumGrid project={project} track={track} playhead={playhead} playing={playing} startBeat={start} loop={region} loopOn={loopOn} onSeek={seek} onLoop={markLoop}
            onNotes={(notes, key) => patchTrack(track.id, t => ({ ...t, notes }), { key })} />
        ) : (
          <PianoRoll
            project={project}
            track={track}
            playhead={playhead}
            playing={playing}
            startBeat={start}
            loop={region}
            loopOn={loopOn}
            onSeek={seek}
            onLoop={markLoop}
            onNotes={(notes, key) => patchTrack(track.id, t => ({ ...t, notes }), { key })}
          />
        )}
        <TrackPanel
          track={track}
          onVoice={v => patchTrack(track.id, t => ({ ...t, voice: v }), { key: `voice:${track.id}` })}
          loading={loadingId === track.id}
          error={sfError}
          onLoadFile={loadSoundFont}
          onPreset={choosePreset}
          onBuiltIn={useBuiltIn}
          onMacro={(k: keyof Macros, v: number) => { patchTrack(track.id, t => ({ ...t, macros: { ...t.macros, [k]: v } }), { key: `macro:${track.id}:${k}` }); scheduleAudition(track.id); }}
          onVibe={m => { patchTrack(track.id, t => ({ ...t, macros: { ...m } })); scheduleAudition(track.id, 150); }}
          onPan={v => { patchTrack(track.id, t => ({ ...t, pan: v === 0 ? undefined : v }), { key: `pan:${track.id}` }); scheduleAudition(track.id); }}
          onCompare={on => { engine.setBypass(track, on); window.clearTimeout(auditionTimer.current); if (!engine.playing) void engine.audition(projectRef.current, track.id); }}
          onVolume={v => { patchTrack(track.id, t => ({ ...t, volume: v }), { key: `volume:${track.id}` }); scheduleAudition(track.id); }}
          onMute={m => patchTrack(track.id, t => ({ ...t, muted: m }))}
          onRename={name => patchTrack(track.id, t => ({ ...t, name }), { key: `rename:${track.id}` })}
          onClear={() => patchTrack(track.id, t => ({ ...t, notes: [] }))}
          onRemove={() => removeTrack(track.id)}
          canRemove={project.tracks.length > 1}
        />
      </main>
    </div>
  );
}

function SongFields({ project, patch }: { project: Project; patch: (p: Partial<Project>, key?: string) => void }) {
  return (
    <>
      <label className="field"><span>Key</span>
        <select value={project.key} onChange={e => patch({ key: +e.target.value })} aria-label="Key">
          {NOTE_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
        </select>
      </label>
      <label className="field"><span>Mood</span>
        <select value={project.scaleName} onChange={e => patch({ scaleName: e.target.value as Project['scaleName'] })} aria-label="Mood">
          {Object.entries(SCALE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
      <label className="field"><span>Length</span>
        <select value={project.bars} onChange={e => patch({ bars: +e.target.value })} aria-label="Length">
          {[2, 4, 8, 16].map(b => <option key={b} value={b}>{b} bars</option>)}
        </select>
      </label>
    </>
  );
}
