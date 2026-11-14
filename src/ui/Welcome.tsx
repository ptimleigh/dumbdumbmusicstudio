import { Icon } from './kit';

export function Welcome({ onExample, onClose }: { onExample: () => void; onClose: () => void }) {
  return (
    <section className="welcome" aria-label="Getting started">
      <div>
        <h2>Make your first song</h2>
        <ol className="welcome-steps">
          <li><span className="step-icon"><Icon name="pencil" /></span><span><strong>Add notes</strong>Click or tap the grid. Notes snap to your key, so they sound good together.</span></li>
          <li><span className="step-icon"><Icon name="play" /></span><span><strong>Press Play</strong>Or hit the spacebar to hear your song loop.</span></li>
          <li><span className="step-icon"><Icon name="sparkle" /></span><span><strong>Shape the sound</strong>Try a style, or move Warmth, Punch and Space. Add Drums with “Add track”.</span></li>
        </ol>
        <p className="muted">Your work saves automatically in this browser. Use File → Save song to keep a copy.</p>
      </div>
      <div className="welcome-actions">
        <button className="btn-primary btn" onClick={onExample}><Icon name="play" size={16} />Hear an example song</button>
        <button className="btn" onClick={onClose}>Start from scratch</button>
      </div>
    </section>
  );
}
