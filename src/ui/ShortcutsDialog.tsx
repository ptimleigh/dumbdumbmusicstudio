import { useEffect } from 'react';
import { Icon } from './kit';

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  { title: 'Playing and looping', rows: [[['Space'], 'Play or stop. Play starts at the flag on the ruler'], [['L'], 'Loop on or off'], [['Home'], 'Move the start back to the beginning'], [['Ctrl', 'Z'], 'Undo'], [['Ctrl', 'Shift', 'Z'], 'Redo']] },
  { title: 'Zooming in', rows: [
    [['Ctrl', 'scroll'], 'Zoom the timeline at your cursor (pinch on a trackpad or phone)'],
    [['Ctrl', 'Shift', 'scroll'], 'Make the note rows taller or shorter'],
    [['+', '−'], 'Zoom in or out'], [['0'], 'Fit the whole song in the window'],
  ] },
  { title: 'Adding and selecting notes (and drum hits)', rows: [
    [['Click'], 'Add a note on the grid'],
    [['Shift', 'drag'], 'Select several notes with a box'],
    [['Shift', 'click'], 'Add or remove a note from the selection'],
    [['Ctrl', 'A'], 'Select all notes on this track'],
    [['Esc'], 'Deselect'],
  ] },
  { title: 'Editing the selection (the same keys work on drum hits)', rows: [
    [['←', '→'], 'Move earlier or later'],
    [['↑', '↓'], 'Move higher or lower'],
    [['Shift', '↑ ↓'], 'Move an octave'],
    [['Ctrl', 'C'], 'Copy'], [['Ctrl', 'V'], 'Paste (each paste lands after the last)'],
    [['Ctrl', 'D'], 'Repeat: copy and place right after'],
    [['Delete'], 'Remove the selected notes'],
  ] },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onPointerDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog wide">
        <div className="dialog-head"><h2>Keyboard shortcuts</h2><button className="btn-icon" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        {GROUPS.map(g => (
          <section key={g.title} className="shortcut-group">
            <h3>{g.title}</h3>
            <dl>
              {g.rows.map(([keys, what]) => (
                <div key={what}><dt>{keys.map((k, i) => <span key={i}>{i > 0 && ' + '}<kbd>{k}</kbd></span>)}</dt><dd>{what}</dd></div>
              ))}
            </dl>
          </section>
        ))}
        <p className="muted small">On a phone or tablet, use the buttons that appear under the grid when notes are selected.</p>
      </div>
    </div>
  );
}
