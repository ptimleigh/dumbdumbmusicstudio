import { useRef, useState } from 'react';
import type { Project } from '../music/types';
import { engine } from '../audio/engine';
import { encodeWav } from '../audio/wav';
import { fileNameFor } from '../music/serialize';

const TAIL_SECONDS = 3;

export function ExportDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const [phase, setPhase] = useState<'ready' | 'recording' | 'done' | 'error'>('ready');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const signal = useRef({ cancelled: false });

  const songSeconds = (project.bars * project.beatsPerBar * 60) / project.tempo;
  const total = Math.ceil(songSeconds + TAIL_SECONDS);
  const hasNotes = project.tracks.some(t => t.notes.length > 0);

  async function start() {
    signal.current = { cancelled: false };
    setPhase('recording'); setProgress(0);
    try {
      const result = await engine.record({ tailSeconds: TAIL_SECONDS, onProgress: setProgress, signal: signal.current });
      if (!result) { onClose(); return; }
      const wav = encodeWav(result.channels, result.sampleRate, -1);
      const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
      const a = document.createElement('a');
      a.href = url; a.download = fileNameFor(project).replace(/\.dumbdumb\.json$/, '.wav');
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      setMessage(a.download); setPhase('done');
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
        <h2>Export as WAV</h2>
        {phase === 'ready' && (
          <>
            <p>Your song plays once, from the start, while it is recorded to an audio file. It takes about <strong>{total} seconds</strong>,
              which includes {TAIL_SECONDS} seconds at the end so echoes and reverb fade out naturally.</p>
            <p className="muted">You will hear it as it records. Keep other sounds on your computer quiet, and leave this tab open and in front until it finishes.</p>
            {!hasNotes && <p className="error">There are no notes yet, so the file would be silent.</p>}
            <div className="row-btns">
              <button className="play" onClick={start} disabled={!hasNotes}>Start recording</button>
              <button onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
        {phase === 'recording' && (
          <>
            <p>Recording… {Math.round(progress * total)} of {total} seconds</p>
            <div className="bar"><div className="bar-fill" style={{ width: `${progress * 100}%` }} /></div>
            <div className="row-btns"><button onClick={cancel}>Cancel</button></div>
          </>
        )}
        {phase === 'done' && (
          <>
            <p>Done. Your file <strong>{message}</strong> was downloaded. It is normalized so the loudest moment sits just below the maximum, so nothing is clipped.</p>
            <div className="row-btns"><button className="play" onClick={onClose}>Close</button></div>
          </>
        )}
        {phase === 'error' && (
          <>
            <p className="error">{message}</p>
            <div className="row-btns"><button onClick={() => setPhase('ready')}>Try again</button><button onClick={onClose}>Close</button></div>
          </>
        )}
      </div>
    </div>
  );
}
