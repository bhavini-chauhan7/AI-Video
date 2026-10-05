# 🎬 AI Video Generator

Describe the video you want and get an animated, voiced video ready for YouTube: scenes, on-screen text, voice-overs with multiple character voices, **sung nursery rhymes and original songs with karaoke lyrics**, captions, transitions and a soundtrack. It's built for kids' channels and for content aimed at teens and young adults.

1. **Pick the audience and describe the video.** The audiences are Little kids (3–6), Kids (7–12), Teens, Gen Z (18–25) or Everyone. Then type something like *"A bedtime story about a little dragon who was scared of the dark"* and pick a length, a format (16:9 for YouTube, 9:16 for Shorts, or 1:1) and an optional style.
2. **Claude writes the storyboard.** You get a scene-by-scene plan with headings, narration, a **cast of characters with voice styles**, layouts, colors, transitions and animations, all written for the audience you picked. Kids' videos follow YouTube's made-for-kids rules (no "like and subscribe").
3. **Give it voices.** One click generates a voice-over for every scene, with each character speaking in its own voice. You can also record your own voice 🎙 or upload audio for any scene.
4. **Edit and preview.** Change any scene: the text, timing, colors, emoji or layout. You can also upload your own images, which get a slow pan-and-zoom. Reorder, duplicate or delete scenes, and watch the result live.
5. **Export.** The video renders in your browser at 1080p or 720p as MP4 (H.264) or WebM. Voices and music are mixed in, and the music automatically gets quieter under speech. A YouTube thumbnail is one click away. If the server has `ffmpeg`, one click converts WebM to MP4.

## Quick start

```bash
npm install
npm run setup:voices                  # free offline voices + singing: installs Kokoro TTS and pyworld, downloads ~210 MB of models
export ANTHROPIC_API_KEY=sk-ant-...   # optional, enables AI-written storyboards
npm start                             # http://localhost:3000
```

Without an API key the app still works. It builds a template storyboard from your prompt, and you can edit that by hand. Without a voice engine you can still record or upload a voice-over for each scene.

Requirements: Node.js 20+, Python 3.10+ (for the free voices) and a recent Chrome, Edge or Firefox. `ffmpeg` is recommended: it powers the voice effects (kid, robot, monster…), loudness normalization and WebM-to-MP4 conversion.

## Songs and nursery rhymes

Click **🎵 Song / nursery rhyme**, pick a song, press **Generate**, then **🎵 Generate singing & voices**.

- **Classic rhymes (free, no API key needed):** Twinkle Twinkle Little Star, Mary Had a Little Lamb, London Bridge, Row Row Row Your Boat and Old MacDonald. All use traditional, public-domain lyrics and melodies.
- **Original songs:** Claude writes the lyrics *and* the melody, and repeats the chorus so kids learn it. This needs `ANTHROPIC_API_KEY`. Original songs are better for a monetized channel than rhymes everyone uses.
- **ACE-Step AI singer (free, open source, human-like):** the recommended singer. The app records a guide of your song (melody and backing, on the beat), and [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) re-sings it with a natural voice and real-sounding instruments. It keeps the melody and timing, so the karaoke stays in sync. ACE-Step is MIT-licensed, so it's free for monetized channels. See [Setting up ACE-Step](#setting-up-ace-step) below.
- **Built-in singer (free, offline, synthetic):** a Kokoro voice is turned into singing with the WORLD vocoder. It's always in tune and on the beat, but it sounds like a synthetic singer. It's also used to make ACE-Step's guide recording.
- **Backing music:** chords are worked out from the melody automatically, and the arrangement is ukulele strums, bass, a bell doubling the tune, and light drums.
- **Karaoke lyrics:** each syllable lights up as it's sung, with a bouncing ball, so kids can sing along.
- **Edit anything:** tempo, key, the lyrics and the melody. Melodies use simple note text (`C4 C4 G4 G4 A4 A4 G4:2`; `:2` means two beats, `R` is a rest), and the app warns you if the syllable and note counts don't match.
- **ElevenLabs Music (paid, optional):** with `ELEVENLABS_API_KEY` set, choose "ElevenLabs Music" and click **Compose** to get a studio-quality song with real-sounding vocals. Each scene becomes one section of the song, so the lyrics stay in sync. ElevenLabs writes its own arrangement, so a classic rhyme's tune may not match the traditional one exactly.
- **Your own voice:** you can always record 🎙 yourself singing any line.

## 3D characters

Turn any video or song into a **3D animated cartoon**: cute characters that talk, sing and move, with **mouths synced to their voices**. This uses [fal.ai](https://fal.ai), one account that gives access to several AI models:

| Step | Model | What it does |
|---|---|---|
| Design | FLUX.1 Kontext (text-to-image) | Draws each character once as a 3D cartoon, from its "Looks like" description |
| Scene | FLUX.1 Kontext (image editing) | Puts *that same* character into each scene, so characters stay consistent |
| Animate | Kling 2.1 image-to-video | Brings the scene to life as a 5- or 10-second clip |
| Lip-sync | Kling LipSync | Moves the character's mouth to the scene's voice-over or singing |

**Setup:**
1. Create an account at [fal.ai](https://fal.ai), add credit, and create an API key under Dashboard → Keys.
2. Start the app with `FAL_KEY=your-key npm start`.

**Make a video:**
1. Generate a storyboard as usual, then press **Generate singing & voices** (or **Generate all voice-overs**) so the lips have audio to follow.
2. In **Voices & cast**, check each character's **Looks like** description. Optionally press **🎨 Design 3D character** to preview one.
3. Edit **What happens (3D scene)** on any scene you like.
4. Press **🎬 Make the 3D video**. You'll see the price first. Scenes render three at a time, a few minutes each.
5. Play, then export as usual. The titles and karaoke lyrics move to the bottom of the screen so the characters stay visible.

You can remake a single scene with its **🎬 Make 3D** button. A scene shows *needs update* when its description, characters or voice changed.

**Cost** (approximate fal.ai prices; you're shown an estimate before anything is charged):

| Item | Cost |
|---|---|
| Character design | $0.04 |
| 5-second scene (still + animation + lip-sync) | ~$0.39 |
| 10-second scene | ~$0.74 |
| 40-second nursery rhyme | ~$3–5 |

**Good to know:**
- The character a scene is *about* (named in its description) is kept identical. Other characters are drawn from their descriptions, so they can vary a little between scenes.
- Lip-sync needs a face the model can recognize. For a star, a teapot or a very stylized face it may be skipped, and the scene keeps its animation without lip-sync.
- Clips and images are saved in `./media` and served by this app, so projects keep working after fal.ai's links expire.

## Setting up ACE-Step

ACE-Step runs as a separate program next to this app. Most people only need to do this once.

1. **Install it** (pick your computer):
   - **Windows:** download the [portable package](https://files.acemusic.ai/acemusic/win/ACE-Step-1.5.7z), unzip it, and run `start_api_server.bat`.
   - **Mac (Apple Silicon M1–M4):** download the [portable package](https://files.acemusic.ai/acemusic/mac/ACE-Step-1.5.zip), unzip it, and run `start_api_server_macos.sh`.
   - **Linux, or any computer with Python:**
     ```bash
     curl -LsSf https://astral.sh/uv/install.sh | sh
     git clone https://github.com/ace-step/ACE-Step-1.5.git && cd ACE-Step-1.5
     uv sync
     uv run acestep-api
     ```
2. **Wait for the first start.** It downloads its models once (several GB) and then listens on `http://localhost:8001`.
3. **Restart this app** (`npm start`). The Song panel's **Singing engine** shows "ACE-Step AI singer", and new songs use it automatically.
4. **Sing:** make your song, then press **🎤 Sing it with ACE-Step**. The **Follow the melody** slider controls how closely it sticks to the original tune: higher means closer, lower gives it more freedom.

**Speed:**

| Computer | Time per song |
|---|---|
| NVIDIA graphics card (4 GB+ video memory) | Seconds |
| Apple Silicon Mac | Under a minute |
| Ordinary computer without a graphics card | Works, but can take several minutes |

**No suitable computer?** Run ACE-Step on a rented cloud GPU and point the app at it with `ACESTEP_URL=https://your-server:8001`. If you set an `ACESTEP_API_KEY` on that server, set the same key here.

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
| **Songs** | 5 classic nursery rhymes plus AI-written originals; human-like ACE-Step singer, free built-in singer, or ElevenLabs Music; karaoke lyrics; auto-harmonized backing |
| **Voice-over** | multi-character cast, 46 free voices plus ElevenLabs and OpenAI, character effects, mic recording, music ducking under speech |
| **Captions** | narration shown as subtitles, timed across each scene |
| **Fonts** | modern, rounded (Baloo 2, also covers Hindi script), bold (Poppins) |
| **3D characters** | AI-generated 3D cartoon characters that stay consistent across scenes, animated clips, lip-sync to voices and singing (fal.ai) |
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
| `ELEVENLABS_API_KEY` | none | Enables ElevenLabs voices (`ELEVENLABS_MODEL`, default `eleven_multilingual_v2`) and ElevenLabs Music (`ELEVENLABS_MUSIC_MODEL`, default `music_v1`) |
| `OPENAI_API_KEY` | none | Enables OpenAI voices (`OPENAI_TTS_MODEL`, default `gpt-4o-mini-tts`) |
| `FAL_KEY` | none | Enables 3D characters through fal.ai (`FAL_VIDEO_MODEL`, `FAL_LIPSYNC_MODEL`, `FAL_STILL_MODEL`, `FAL_DESIGN_MODEL` override the models) |
| `MEDIA_DIR` | `./media` | Where 3D character images and clips are stored |
| `ACESTEP_URL` | `http://127.0.0.1:8001` | ACE-Step API server used for the human-like singer |
| `ACESTEP_API_KEY` | none | Key for an ACE-Step server started with `ACESTEP_API_KEY` |
| `ACESTEP_STEPS` | `8` | ACE-Step inference steps (turbo model: 8 is recommended) |

## How it works

```
browser                                   server (Express)
───────                                   ────────────────
prompt + audience ─ POST /api/storyboard ▶ Claude → storyboard + cast JSON (validated + normalized)
storyboard editor ◀─────────────────────  (template fallback if no key / API error)
scene narration ─── POST /api/tts ───────▶ Kokoro / ElevenLabs / OpenAI → ffmpeg effects → MP3
sung line ───────── POST /api/sing ──────▶ Kokoro syllables → WORLD vocoder (pitch + timing) → MP3
3D scene ────────── POST /api/3d/scene ──▶ fal.ai: Kontext still → Kling animation → Kling lip-sync (background job)
guide recording ─── POST /api/song-ace ───▶ ACE-Step "cover" → human-like sung song
whole song ──────── POST /api/song-track ▶ ElevenLabs Music (optional)
canvas renderer (pure function of time) + Web Audio mix (voices + ducked music)
MediaRecorder ─▶ .mp4 / .webm ─ POST /api/convert (optional) ─▶ ffmpeg → H.264 MP4
```

- `lib/claude.js`: the prompt and the Claude call (structured outputs, refusal handling, server-side fallback).
- `lib/storyboard.js`: the storyboard schema (including cast and audiences), normalization or clamping of any input, and the offline template generator.
- `lib/voices.js`: the voice catalog, character presets and ffmpeg effect chains.
- `lib/tts.js`: the TTS engines (a persistent Kokoro Python worker, plus ElevenLabs and OpenAI), singing, ElevenLabs Music, effects and a cache. `tts/kokoro_worker.py` is the worker, and `tts/singer.py` turns speech into singing.
- `lib/fal3d.js`: the 3D character pipeline (design → scene still → animation → lip-sync) and cost estimates.
- `lib/acestep.js`: the ACE-Step client (cover task, polling, download).
- `lib/songs.js`: the nursery-rhyme songbook. `public/js/song.js` holds the melody parser, syllable matching and auto-harmonizer, and is shared by the server and the browser.
- `public/js/renderer.js`: draws any frame at time `t`. Preview, seeking and export all go through the same code path.
- `public/js/audio.js`: the procedural music engine (pads, bass, arpeggios, drums, reverb), uploaded-track playback, and the voice-over bus with music ducking.
- `public/js/app.js`: the UI, playback, editing and export.

Export records in real time, so a 30-second video takes about 30 seconds to export. Keep the tab visible while it records, because browsers throttle hidden tabs. Kokoro generates speech on the CPU at roughly real time, so voicing a 30-second video takes about 30–60 seconds. Results are cached, so regenerating unchanged scenes is instant.

## Development

```bash
npm run dev   # restart on file changes
npm test      # unit + API tests (the MP4 conversion test runs if ffmpeg is installed)
```
