# Dumb Dumb Music Studio

A web-based music studio for people without a sound-engineering degree.
Compose original music (notes, durations, multiple tracks), then shape the sound with
plain-language sliders (Warmth, Punch, Space) instead of technical knobs.

## Run it

```bash
npm install
npm run dev
```

## Architecture

- `src/music/` – project data model and music theory (scales, chords, key-lock).
- `src/audio/instrument.ts` – `Instrument` interface (built-in synth now; SoundFont/SF2 and plugins later).
- `src/audio/macros.ts` – pure mapping from friendly 0–10 sliders to real DSP parameters (tested).
- `src/audio/engine.ts` – Web Audio engine: look-ahead scheduler + per-track effect chain.
- `src/ui/` – React UI: piano roll, track tabs, sound-shaping panel.

## Roadmap

1. SoundFont (SF2) loading as an `Instrument`
2. Drum/percussion tracks, drag to move/resize notes
3. WAV and MIDI export, project save/load
4. Audio recording/import
5. Desktop wrapper for VST3/CLAP plugin hosting
