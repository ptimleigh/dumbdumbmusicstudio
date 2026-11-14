# Dumb Dumb Music Studio

A web-based music studio for people without a sound-engineering degree.
Compose original music (notes, durations, multiple tracks), then shape the sound with
plain-language sliders (Warmth, Punch, Space) instead of technical knobs.

## Run it

```bash
npm install
npm run dev
```

## Put it online (GitHub Pages)

The app is a static site, so GitHub Pages can host it for free over HTTPS. HTTPS matters: phone browsers only allow
SoundFonts and WAV export on secure addresses.

1. On GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions** (one time).
2. Push to `main` (or run the **Deploy to GitHub Pages** workflow from the **Actions** tab).
3. The address appears in the workflow run and in Settings → Pages, usually `https://<your-username>.github.io/dumbdumbmusicstudio/`.

The workflow (`.github/workflows/deploy.yml`) runs the tests, builds, and publishes. Songs and SoundFonts stay in each
person's own browser; nothing is uploaded anywhere.

## Architecture

- `src/music/` – project data model and music theory (scales, chords, key-lock).
- `src/audio/instrument.ts` – `Instrument` interface (built-in synth; plugins later).
- `src/audio/soundfont.ts` – SoundFont (SF2/SF3/DLS) instrument. One synth per track so each track keeps its own effect chain.
- `src/audio/macros.ts` – pure mapping from friendly 0–10 sliders to real DSP parameters (tested).
- `src/audio/macros.ts` also holds the one-click sound styles (Vibes).
- `src/audio/engine.ts` – Web Audio engine: look-ahead scheduler + per-track effect chain.
- `src/music/drums.ts`, `src/ui/DrumGrid.tsx` – drum step grid (drum hits are ordinary notes with General MIDI pitches).
- `src/audio/recorder.ts`, `src/audio/wav.ts`, `src/ui/ExportDialog.tsx` – WAV export (plays once in real time while recording, then encodes 16-bit PCM).
- `src/music/harmony.ts` – chords from the key, chord detection, "what comes next" suggestions, clash detection (pure, tested).
- `src/music/bend.ts` – note slides (pitch glides up or down while a note plays); built-in synth ramps frequency, SoundFonts use MIDI pitch wheel events.
- `src/music/edit.ts` – pure note-editing helpers: group move/resize, scale steps, copy/paste, box selection (tested).
- `src/music/history.ts` – undo/redo (pure, tested).
- `src/music/serialize.ts`, `src/storage.ts` – project files, autosave (localStorage) and SoundFont storage (IndexedDB).
- `src/ui/theme.css` – design tokens (dark and light). `shell.css` – layout and components. `kit.tsx` – icons, popovers, segmented control, switch, slider, toasts.
- `src/ui/` – React UI: piano roll, track tabs, sound-shaping panel.

## Roadmap

1. ~~SoundFont (SF2) loading as an `Instrument`~~ (done: per-track, via SpessaSynth)
2. ~~Drum tracks~~ (done: step grid, built-in kit, SoundFont drum kits)
3. ~~Project save/load~~ (done: autosave + file; SoundFonts remembered in the browser)
3. ~~Undo/redo~~ (done)
3. ~~WAV export~~ (done: real-time recording) · MIDI export
4. ~~Polish pass~~ (done: welcome + example song, built-in sound choices, touch/mobile layout, select-to-delete notes)
5. ~~Smarter music help~~ (done: chord suggestions, clash highlights, ghost notes)
6. Audio recording/import
7. Desktop wrapper for VST3/CLAP plugin hosting
