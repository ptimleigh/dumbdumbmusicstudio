import type { Note, Project, ScaleName, Track } from './types';
import { newProject, newTrack, uid } from './project';
import { SCALES } from './theory';
import { cleanBend } from './bend';
import { VOICE_IDS, type VoiceId } from '../audio/instrument';

const FORMAT = 'dumbdumbmusicstudio';
const VERSION = 1;

export function serializeProject(p: Project): string {
  return JSON.stringify({ format: FORMAT, version: VERSION, project: p }, null, 2);
}

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

function parseTrack(raw: any): Track | null {
  if (!raw || typeof raw !== 'object') return null;
  const role = ['melody', 'bass', 'chords', 'lead', 'drums'].includes(raw.role) ? raw.role : 'melody';
  const base = newTrack(role);
  const notes: Note[] = Array.isArray(raw.notes)
    ? raw.notes
        .filter((n: any) => n && Number.isFinite(n.pitch) && Number.isFinite(n.start) && Number.isFinite(n.duration) && n.duration > 0)
        .map((n: any): Note => ({
          id: typeof n.id === 'string' ? n.id : uid('n'),
          pitch: Math.round(num(n.pitch, 0, 127, 60)),
          start: Math.max(0, n.start),
          duration: n.duration,
          ...(cleanBend(n.bend) ? { bend: cleanBend(n.bend) } : {}),
        }))
    : [];
  let sound: Track['sound'] = { kind: 'synth' };
  const s = raw.sound;
  if (s && s.kind === 'soundfont' && typeof s.fileName === 'string' && Array.isArray(s.presets) && s.presets.length > 0) {
    const presets = s.presets
      .filter((x: any) => x && typeof x.name === 'string')
      .map((x: any) => ({ name: x.name, bankMSB: num(x.bankMSB, 0, 127, 0), bankLSB: num(x.bankLSB, 0, 127, 0), program: num(x.program, 0, 127, 0) }));
    if (presets.length > 0) sound = { kind: 'soundfont', fileName: s.fileName, presets, selected: Math.round(num(s.selected, 0, presets.length - 1, 0)) };
  }
  return {
    ...base,
    id: typeof raw.id === 'string' ? raw.id : base.id,
    name: typeof raw.name === 'string' ? raw.name : base.name,
    color: typeof raw.color === 'string' ? raw.color : base.color,
    notes,
    macros: {
      warmth: num(raw.macros?.warmth, 0, 10, 5),
      punch: num(raw.macros?.punch, 0, 10, 5),
      space: num(raw.macros?.space, 0, 10, 5),
    },
    sound,
    voice: VOICE_IDS.includes(raw.voice) ? (raw.voice as VoiceId) : undefined,
    volume: num(raw.volume, 0, 1, 0.8),
    ...(num(raw.pan, -1, 1, 0) !== 0 ? { pan: num(raw.pan, -1, 1, 0) } : {}),
    muted: raw.muted === true,
  };
}

/** Reads a project from text. Throws an Error with a plain-language message if it isn't one. */
export function parseProject(text: string): Project {
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not a project file.'); }
  const raw = data?.format === FORMAT ? data.project : null;
  if (!raw || typeof raw !== 'object') throw new Error('That file is not a Dumb Dumb Music Studio project.');
  if (typeof data.version === 'number' && data.version > VERSION) throw new Error('That project was saved by a newer version of the app.');
  const tracks = (Array.isArray(raw.tracks) ? raw.tracks : []).map(parseTrack).filter((t: Track | null): t is Track => t !== null);
  const d = newProject();
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : d.name,
    tempo: num(raw.tempo, 40, 240, d.tempo),
    beatsPerBar: Math.round(num(raw.beatsPerBar, 1, 12, 4)),
    bars: Math.round(num(raw.bars, 1, 64, d.bars)),
    key: Math.round(num(raw.key, 0, 11, 0)),
    scaleName: (raw.scaleName in SCALES ? raw.scaleName : d.scaleName) as ScaleName,
    tracks: tracks.length > 0 ? tracks : d.tracks,
  };
}

export function fileNameFor(p: Project): string {
  const safe = p.name.trim().replace(/[^\w\- ]+/g, '').replace(/\s+/g, '-') || 'project';
  return `${safe}.dumbdumb.json`;
}
