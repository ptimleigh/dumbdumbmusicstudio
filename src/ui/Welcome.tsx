export function Welcome({ onExample, onClose }: { onExample: () => void; onClose: () => void }) {
  return (
    <section className="welcome" aria-label="Getting started">
      <div className="welcome-text">
        <h2>Make your first song</h2>
        <ol>
          <li><strong>Add notes.</strong> Click or tap the grid. Notes snap to your key, so they sound good together.</li>
          <li><strong>Press Play</strong> (or the spacebar) to hear your song loop.</li>
          <li><strong>Shape the sound</strong> with Warmth, Punch and Space on the right. Add more tracks, including Drums, with “+ Add track”.</li>
        </ol>
        <p className="muted">Your work saves automatically in this browser. Use Save to keep a copy as a file.</p>
      </div>
      <div className="welcome-actions">
        <button className="play" onClick={onExample}>Hear an example song</button>
        <button onClick={onClose}>Start from scratch</button>
      </div>
    </section>
  );
}
