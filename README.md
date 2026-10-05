# 🎬 AI Video Generator

Describe the video you want and get an animated motion-graphics video you can download: scenes, on-screen text, captions, transitions and a generated soundtrack.

1. **Describe it.** Type something like *"A 30-second promo for a coffee shop that roasts its own beans"*, then pick a length, a format (16:9, 9:16 or 1:1) and an optional style.
2. **Claude writes the storyboard.** You get a scene-by-scene plan with headings, bullet points, narration, layouts, color palettes, backgrounds, transitions and text animations.
3. **Edit and preview.** Change any scene: the text, timing, colors, emoji or layout. You can also upload your own images, which get a slow pan-and-zoom. Reorder, duplicate or delete scenes, and watch the result live.
4. **Export.** The video renders in your browser to MP4 (H.264) or WebM, with the soundtrack mixed in. If the server has `ffmpeg`, one click converts WebM to MP4.

## Quick start

```bash
npm install
export ANTHROPIC_API_KEY=sk-ant-...   # optional, enables AI-written storyboards
npm start                             # http://localhost:3000
```

Without an API key the app still works. It builds a template storyboard from your prompt, and you can edit that by hand.

Requirements: Node.js 20+ and a recent Chrome, Edge or Firefox. `ffmpeg` on the server is optional and only used for WebM-to-MP4 conversion.

## Features

| | |
|---|---|
| **AI storyboard** | Claude (`claude-opus-5-5`) with structured outputs, so the result always matches the storyboard schema |
| **Layouts** | title, bullets, quote, statistic (numbers count up), closing |
| **Backgrounds** | animated gradient, particles, waves, retro grid, bokeh, or your own image (Ken Burns effect) |
| **Transitions** | fade, slide, zoom, diagonal wipe |
| **Text animation** | fade, slide-up, typewriter, pop |
| **Music** | generated in the browser to match the mood (calm, upbeat, epic, playful), or your own audio file |
| **Captions** | narration shown as subtitles, timed across each scene |
| **Formats** | 1280×720 landscape, 720×1280 vertical (Reels, Shorts, TikTok), 1080×1080 square |
| **Projects** | autosaves in the browser; Save/Open lets you keep the project as a JSON file |

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Enables AI storyboard generation |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model used for storyboards |
| `PORT` | `3000` | HTTP port |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg binary used for MP4 conversion |

## How it works

```
browser                                   server (Express)
───────                                   ────────────────
prompt ───────── POST /api/storyboard ──▶ Claude → storyboard JSON (validated + normalized)
storyboard editor ◀─────────────────────  (template fallback if no key / API error)
canvas renderer (pure function of time) + Web Audio soundtrack
MediaRecorder ─▶ .mp4 / .webm ─ POST /api/convert (optional) ─▶ ffmpeg → H.264 MP4
```

- `lib/claude.js`: the prompt and the Claude call (structured outputs, refusal handling, server-side fallback).
- `lib/storyboard.js`: the storyboard schema, normalization or clamping of any input, and the offline template generator.
- `public/js/renderer.js`: draws any frame at time `t`. Preview, seeking and export all go through the same code path.
- `public/js/audio.js`: the procedural music engine (pads, bass, arpeggios, drums, reverb) and uploaded-track playback.
- `public/js/app.js`: the UI, playback, editing and export.

Export records in real time, so a 30-second video takes about 30 seconds to export. Keep the tab visible while it records, because browsers throttle hidden tabs.

## Development

```bash
npm run dev   # restart on file changes
npm test      # unit + API tests (the MP4 conversion test runs if ffmpeg is installed)
```
