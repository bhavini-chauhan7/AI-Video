# 🎬 AI Video Generator

Describe the video you want and get an animated, voiced video ready for YouTube: scenes, on-screen text, voice-overs with multiple character voices, captions, transitions and a soundtrack. It's built for kids' channels and for content aimed at teens and young adults.

1. **Pick the audience and describe the video.** The audiences are Little kids (3–6), Kids (7–12), Teens, Gen Z (18–25) or Everyone. Then type something like *"A bedtime story about a little dragon who was scared of the dark"* and pick a length, a format (16:9 for YouTube, 9:16 for Shorts, or 1:1) and an optional style.
2. **Claude writes the storyboard.** You get a scene-by-scene plan with headings, narration, a **cast of characters with voice styles**, layouts, colors, transitions and animations, all written for the audience you picked. Kids' videos follow YouTube's made-for-kids rules (no "like and subscribe").
3. **Give it voices.** One click generates a voice-over for every scene, with each character speaking in its own voice. You can also record your own voice 🎙 or upload audio for any scene.
4. **Edit and preview.** Change any scene: the text, timing, colors, emoji or layout. You can also upload your own images, which get a slow pan-and-zoom. Reorder, duplicate or delete scenes, and watch the result live.
5. **Export.** The video renders in your browser at 1080p or 720p as MP4 (H.264) or WebM. Voices and music are mixed in, and the music automatically gets quieter under speech. A YouTube thumbnail is one click away. If the server has `ffmpeg`, one click converts WebM to MP4.

## Quick start

```bash
npm install
npm run setup:voices                  # free offline voices: installs Kokoro TTS + downloads ~120 MB of models
export ANTHROPIC_API_KEY=sk-ant-...   # optional, enables AI-written storyboards
npm start                             # http://localhost:3000
```

Without an API key the app still works. It builds a template storyboard from your prompt, and you can edit that by hand. Without a voice engine you can still record or upload a voice-over for each scene.

Requirements: Node.js 20+, Python 3.10+ (for the free voices) and a recent Chrome, Edge or Firefox. `ffmpeg` is recommended: it powers the voice effects (kid, robot, monster…), loudness normalization and WebM-to-MP4 conversion.

## Voices

| Engine | Cost | Voices | Setup |
|---|---|---|---|
| **Kokoro** (default) | Free, runs offline on your machine, Apache-2.0 license | 46 voices: US and UK English, Hindi, Spanish, French, Italian, Portuguese, Japanese, Chinese | `npm run setup:voices` |
| **ElevenLabs** | Paid API | Every voice in your ElevenLabs account, including cloned voices | `export ELEVENLABS_API_KEY=...` |
| **OpenAI** | Paid API | 11 voices; the character description is sent as acting instructions | `export OPENAI_API_KEY=...` |

When more than one engine is set up, all their voices appear in the same picker.

**Character presets** combine a voice, an effect and a speed: friendly narrator, bedtime storyteller, calm teacher, hype host (Gen Z), energetic host, little kid, little boy, cartoon sidekick, chipmunk, robot, friendly monster, giant, grandpa, jolly Santa and movie-trailer announcer.

**Effects** (need ffmpeg): kid voice, cartoon, chipmunk, deep/giant, monster, robot, echo and radio.

For each scene you can:
- **🔊 Generate** a voice-over, or **▶ play** the one it has.
- **🎙 Record** with your microphone, or **⬆ upload** an audio file.
- **✕ Remove** its voice-over.

When "fit scene length to voice-over" is on, each scene is stretched or shortened to match its narration. A scene shows **needs update** when its text or speaker's voice changed after the voice-over was made.

**Licensing for monetized channels:** Kokoro's model is Apache-2.0, so its audio can be used commercially. For ElevenLabs and OpenAI, check your plan's terms.

## Features

| | |
|---|---|
| **AI storyboard** | Claude (`claude-opus-5-5`) with structured outputs, so the result always matches the storyboard schema |
| **Layouts** | title, bullets, quote, statistic (numbers count up), closing |
| **Backgrounds** | animated gradient, particles, waves, retro grid, bokeh, or your own image (Ken Burns effect) |
| **Transitions** | fade, slide, zoom, diagonal wipe |
| **Text animation** | fade, slide-up, typewriter, pop |
| **Music** | generated in the browser to match the mood (calm, upbeat, epic, playful), or your own audio file |
| **Audiences** | little kids, kids, teens, Gen Z and everyone, each with its own writing style, pacing, fonts, music and narrator |
| **Voice-over** | multi-character cast, 46 free voices plus ElevenLabs and OpenAI, character effects, mic recording, music ducking under speech |
| **Captions** | narration shown as subtitles, timed across each scene |
| **Fonts** | modern, rounded (Baloo 2, also covers Hindi script), bold (Poppins) |
| **Formats** | 1080p or 720p: landscape (YouTube), vertical (Shorts, Reels, TikTok), square; plus a thumbnail PNG |
| **Projects** | autosaves in the browser; Save/Open lets you keep the project as a JSON file |

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Enables AI storyboard generation |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model used for storyboards |
| `PORT` | `3000` | HTTP port |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg binary used for voice effects and MP4 conversion |
| `TTS_PYTHON` | `python3` | Python used to run the Kokoro voice engine |
| `KOKORO_DIR` | `./models` | Where the Kokoro model files live |
| `ELEVENLABS_API_KEY` | none | Enables ElevenLabs voices (`ELEVENLABS_MODEL`, default `eleven_multilingual_v2`) |
| `OPENAI_API_KEY` | none | Enables OpenAI voices (`OPENAI_TTS_MODEL`, default `gpt-4o-mini-tts`) |

## How it works

```
browser                                   server (Express)
───────                                   ────────────────
prompt + audience ─ POST /api/storyboard ▶ Claude → storyboard + cast JSON (validated + normalized)
storyboard editor ◀─────────────────────  (template fallback if no key / API error)
scene narration ─── POST /api/tts ───────▶ Kokoro / ElevenLabs / OpenAI → ffmpeg effects → MP3
canvas renderer (pure function of time) + Web Audio mix (voices + ducked music)
MediaRecorder ─▶ .mp4 / .webm ─ POST /api/convert (optional) ─▶ ffmpeg → H.264 MP4
```

- `lib/claude.js`: the prompt and the Claude call (structured outputs, refusal handling, server-side fallback).
- `lib/storyboard.js`: the storyboard schema (including cast and audiences), normalization or clamping of any input, and the offline template generator.
- `lib/voices.js`: the voice catalog, character presets and ffmpeg effect chains.
- `lib/tts.js`: the TTS engines (a persistent Kokoro Python worker, plus ElevenLabs and OpenAI), effects and a cache. `tts/kokoro_worker.py` is the worker.
- `public/js/renderer.js`: draws any frame at time `t`. Preview, seeking and export all go through the same code path.
- `public/js/audio.js`: the procedural music engine (pads, bass, arpeggios, drums, reverb), uploaded-track playback, and the voice-over bus with music ducking.
- `public/js/app.js`: the UI, playback, editing and export.

Export records in real time, so a 30-second video takes about 30 seconds to export. Keep the tab visible while it records, because browsers throttle hidden tabs. Kokoro generates speech on the CPU at roughly real time, so voicing a 30-second video takes about 30–60 seconds. Results are cached, so regenerating unchanged scenes is instant.

## Development

```bash
npm run dev   # restart on file changes
npm test      # unit + API tests (the MP4 conversion test runs if ffmpeg is installed)
```
