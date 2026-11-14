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
- `src/audio/instrument.ts` – `Instrument` interface (built-in synth; plugins later).
- `src/audio/soundfont.ts` – SoundFont (SF2/SF3/DLS) instrument. One synth per track so each track keeps its own effect chain.
- `src/audio/macros.ts` – pure mapping from friendly 0–10 sliders to real DSP parameters (tested).
- `src/audio/engine.ts` – Web Audio engine: look-ahead scheduler + per-track effect chain.
- `src/music/drums.ts`, `src/ui/DrumGrid.tsx` – drum step grid (drum hits are ordinary notes with General MIDI pitches).
- `src/audio/recorder.ts`, `src/audio/wav.ts`, `src/ui/ExportDialog.tsx` – WAV export (plays once in real time while recording, then encodes 16-bit PCM).
- `src/music/history.ts` – undo/redo (pure, tested).
- `src/music/serialize.ts`, `src/storage.ts` – project files, autosave (localStorage) and SoundFont storage (IndexedDB).
- `src/ui/` – React UI: piano roll, track tabs, sound-shaping panel.

## Roadmap

1. ~~SoundFont (SF2) loading as an `Instrument`~~ (done: per-track, via SpessaSynth)
2. ~~Drum tracks~~ (done: step grid, built-in kit, SoundFont drum kits)
3. ~~Project save/load~~ (done: autosave + file; SoundFonts remembered in the browser)
3. ~~Undo/redo~~ (done)
3. ~~WAV export~~ (done: real-time recording) · MIDI export
4. ~~Polish pass~~ (done: welcome + example song, built-in sound choices, touch/mobile layout, select-to-delete notes)
5. Smarter music help (chord suggestions, clash hints)
6. Audio recording/import
7. Desktop wrapper for VST3/CLAP plugin hosting
