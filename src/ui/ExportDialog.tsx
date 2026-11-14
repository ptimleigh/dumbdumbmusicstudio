import { useRef, useState } from 'react';
import type { Project } from '../music/types';
import { engine } from '../audio/engine';
import { encodeWav, gainForPeak, peakOf } from '../audio/wav';
import { makeZip } from '../audio/zip';
import { baseName } from '../music/serialize';
import { downloadBytes } from './download';
import { Switch } from './kit';

const TAIL_SECONDS = 3;
const trackFileName = (i: number, name: string) => `${String(i + 1).padStart(2, '0')} ${name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'Track'}.wav`;

export function ExportDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [phase, setPhase] = useState<'ready' | 'recording' | 'done' | 'error'>('ready');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [stems, setStems] = useState(false);
  const signal = useRef({ cancelled: false });

  const songSeconds = (project.bars * project.beatsPerBar * 60) / project.tempo;
  const total = Math.ceil(songSeconds + TAIL_SECONDS);
  const hasNotes = project.tracks.some(t => t.notes.length > 0);
  const stemCount = project.tracks.filter(t => !t.muted && t.notes.length > 0).length;

  async function start() {
    signal.current = { cancelled: false };
    setPhase('recording'); setProgress(0);
    try {
      const result = await engine.record({ tailSeconds: TAIL_SECONDS, onProgress: setProgress, signal: signal.current, stems });
      if (!result) { onClose(); return; }
      const base = baseName(project);
      // one gain for everything, so the track files add up to the mix and keep their levels relative to each other
      const gain = gainForPeak(peakOf(result.channels), -1);
      const mix = new Uint8Array(encodeWav(result.channels, result.sampleRate, null, gain));
      if (stems && result.stems.length > 0) {
        const files = [{ name: `${base}.wav`, data: mix }, ...result.stems.map((s, i) => ({ name: `tracks/${trackFileName(i, s.name)}`, data: new Uint8Array(encodeWav(s.channels, result.sampleRate, null, gain)) }))];
        downloadBytes(`${base}-audio.zip`, makeZip(files), 'application/zip');
        setMessage(`${base}-audio.zip`);
      } else {
        downloadBytes(`${base}.wav`, mix, 'audio/wav');
        setMessage(`${base}.wav`);
      }
      setPhase('done');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Something went wrong while recording.'); setPhase('error');
    }
  }

  function cancel() {
    if (phase === 'recording') signal.current.cancelled = true; else onClose();
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Export song">
      <div className="dialog">
        <h2>Export as audio</h2>
        {phase === 'ready' && (
          <>
            <p>Your song plays once, from the start, while it is recorded. It takes about <strong>{total} seconds</strong>,
              which includes {TAIL_SECONDS} seconds at the end so echoes and reverb fade out naturally.</p>
            <div className="export-option">
              <Switch checked={stems} onChange={setStems}>Also save each track on its own</Switch>
              <p className="muted small">
                {stems
                  ? `You get one .zip with the full mix and a separate file for each of the ${stemCount} ${stemCount === 1 ? 'track' : 'tracks'} that ${stemCount === 1 ? 'is' : 'are'} not muted. They all start together and have the same length, so they line up when you drop them into FL Studio or another music program.`
                  : 'Without this, you get one WAV file of the whole song.'}
              </p>
            </div>
            <p className="muted">You will hear it as it records. Keep other sounds on your computer quiet, and leave this tab open and in front until it finishes.</p>
            {!hasNotes && <p className="error">There are no notes yet, so the file would be silent.</p>}
            <div className="row-btns">
              <button className="btn btn-primary" onClick={start} disabled={!hasNotes}>Start recording</button>
              <button className="btn" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
        {phase === 'recording' && (
          <>
            <p>Recording… {Math.round(progress * total)} of {total} seconds</p>
            <div className="bar"><div className="bar-fill" style={{ width: `${progress * 100}%` }} /></div>
            <div className="row-btns"><button className="btn" onClick={cancel}>Cancel</button></div>
          </>
        )}
        {phase === 'done' && (
          <>
            <p>Done. Your file <strong>{message}</strong> was downloaded. It is scaled so the loudest moment sits just below the maximum, so nothing is clipped.{stems ? ' The track files use the same scaling, so they add up to the mix.' : ''}</p>
            <div className="row-btns"><button className="btn btn-primary" onClick={onClose}>Close</button></div>
          </>
        )}
        {phase === 'error' && (
          <>
            <p className="error">{message}</p>
            <div className="row-btns"><button className="btn" onClick={() => setPhase('ready')}>Try again</button><button className="btn" onClick={onClose}>Close</button></div>
          </>
        )}
      </div>
    </div>
  );
}
