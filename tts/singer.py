"""Turns Kokoro speech into singing.

Default (sing_phrase): every word is spoken naturally by Kokoro, syllable
boundaries inside a word are found by aligning it with its separately spoken
syllables, and the words are re-timed onto the notes and re-pitched in one
WORLD vocoder pass. The steadiest part of each vowel is held, pitch is steady
with a hint of the speaker's own intonation, and only long notes get a light
vibrato. Consonants land just before the beat so vowels start on the beat.

Fallback (sing_syllables): each syllable is spoken and tuned on its own.
"""
import re

import numpy as np
import pyworld as pw

FRAME_MS = 5.0
# IPA vowel nuclei produced by espeak for the languages Kokoro speaks.
VOWELS = "aeiouyæɑɒɐɔəɘɚɛɜɝɞɤɨɪʉʊʌʏøœɵɯ"
NUCLEUS = re.compile(r"(aɪ|aʊ|eɪ|oʊ|ɔɪ|əʊ|eə|ɪə|ʊə|[" + VOWELS + r"][ːˑ]?)")


def split_syllables(ipa, n):
    """Split one word's IPA into n syllable chunks (maximal-onset rule)."""
    ipa = ipa.strip()
    nuclei = [m.span() for m in NUCLEUS.finditer(ipa)]
    if n <= 1 or len(nuclei) <= 1:
        return [ipa] + [None] * (n - 1)  # None = hold the previous syllable (melisma)
    # merge extra nuclei so we have at most n
    while len(nuclei) > n:
        i = min(range(len(nuclei) - 1), key=lambda k: nuclei[k + 1][0] - nuclei[k][1])
        nuclei[i] = (nuclei[i][0], nuclei[i + 1][1])
        del nuclei[i + 1]
    cuts = [0]
    for (s0, e0), (s1, _) in zip(nuclei, nuclei[1:]):
        between = ipa[e0:s1]
        cons = [c for c in between if c not in "ˈˌ"]
        # keep one coda consonant if the cluster has 2+, the rest start the next syllable
        keep = 1 if len(cons) >= 2 else 0
        cut, seen = e0, 0
        for j, c in enumerate(between):
            if c in "ˈˌ":
                continue
            if seen == keep:
                cut = e0 + j
                break
            seen += 1
        else:
            cut = s1
        # a stress mark right before the cut belongs to the next syllable
        while cut > e0 and ipa[cut - 1] in "ˈˌ":
            cut -= 1
        cuts.append(cut)
    chunks = [ipa[a:b] for a, b in zip(cuts, cuts[1:] + [len(ipa)])]
    return chunks + [None] * (n - len(chunks))


def midi_hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def _smooth(a, radius, axis=0):
    """Moving average along time (axis 0) with edge padding."""
    if radius <= 0 or a.shape[0] < 3:
        return a
    k = 2 * radius + 1
    pad = np.pad(a, [(radius, radius)] + [(0, 0)] * (a.ndim - 1), mode="edge")
    c = np.cumsum(pad, axis=0)
    c = np.concatenate([np.zeros((1,) + a.shape[1:]), c], axis=0)
    return (c[k:] - c[:-k]) / k


def render_note(audio, fs, dur, pitch, prev_pitch, opts):
    """Return (samples, onset_seconds) for one syllable sung at `pitch` for `dur` seconds.

    Smooth singing tone:
    - the whole vowel is forced voiced (no flicker into noise)
    - the spectral envelope and breathiness are smoothed over time
    - loudness follows a clean attack / sustain / release envelope
    - gentle, delayed vibrato and a soft glide from the previous note
    """
    x = audio.astype(np.float64)
    f0, t = pw.harvest(x, fs, f0_floor=70, f0_ceil=800, frame_period=FRAME_MS)
    sp = pw.cheaptrick(x, f0, t, fs)
    ap = pw.d4c(x, f0, t, fs)
    n = len(f0)
    voiced = np.where(f0 > 0)[0]
    if len(voiced) == 0:  # e.g. a bare consonant: keep as is
        return x, 0.0
    v0, v1 = voiced[0], voiced[-1] + 1
    onset = min(v0, int(150 / FRAME_MS))
    coda = min(n - v1, int(120 / FRAME_MS))
    start = v0 - onset
    total = max(int(round(dur * 1000 / FRAME_MS)), 6)
    # consonants keep their natural length unless the note is short; then they
    # are squeezed so the whole syllable fits and the vowel keeps most of the note
    k = min(1.0, 0.4 * total / max(1, onset + coda))
    onset_out, coda_out = int(round(onset * k)), int(round(coda * k))
    mid = max(2, total - onset_out - coda_out)

    # the steadiest, loudest part of the vowel is what gets held
    energy = sp.sum(axis=1)
    core = np.arange(v0, v1)
    loud = core[energy[core] >= 0.35 * energy[core].max()]
    s0, s1 = (loud[0], loud[-1] + 1) if len(loud) >= 2 else (v0, v1)
    # vowel time map: quick attack into the steady part, slow hold, quick release
    a = max(1, int(mid * 0.12)); r = max(1, int(mid * 0.12)); h = max(1, mid - a - r)
    lin = lambda p, q, m: np.linspace(p, q, m) if m > 0 and q >= p else np.array([], dtype=float)
    vowel_idx = np.concatenate([lin(v0, s0, a), lin(s0, max(s0, s1 - 1), h), lin(max(s0, s1 - 1), v1 - 1, r)])
    idx = np.concatenate([lin(start, v0 - 1, onset_out), vowel_idx, lin(v1, v1 + coda - 1, coda_out)])
    is_vowel = np.zeros(len(idx), bool)
    is_vowel[onset_out:onset_out + len(vowel_idx)] = True

    lo = np.floor(idx).astype(int).clip(0, n - 1)
    hi = (lo + 1).clip(0, n - 1)
    w = (idx - lo)[:, None]
    # interpolate envelopes in the log domain (smoother than linear power)
    logsp = np.log(sp + 1e-16)
    sp2 = np.exp(logsp[lo] * (1 - w) + logsp[hi] * w)
    ap2 = ap[lo] * (1 - w) + ap[hi] * w
    voiced_mask = is_vowel | (f0[lo] > 0) | (f0[hi] > 0)

    # smooth the held vowel so it doesn't flutter frame to frame
    if is_vowel.any():
        vi = np.where(is_vowel)[0]
        sp2[vi] = np.exp(_smooth(np.log(sp2[vi]), 4))
        ap2[vi] = _smooth(ap2[vi], 6)
        # clean, slightly breathy tone: periodic lows, a little air on top
        bins = ap2.shape[1]
        freqs = np.arange(bins) * (fs / 2) / (bins - 1)
        ceiling = np.interp(freqs, [0, 1500, 4000, fs / 2], [0.03, 0.08, 0.35, 0.7])
        ap2[vi] = np.minimum(ap2[vi], ceiling)
        # loudness: hold the steady level with a soft attack and release
        target = np.median(energy[s0:s1]) if s1 > s0 else np.median(energy[core])
        m = len(vi)
        tv = np.arange(m) * FRAME_MS / 1000
        env = np.minimum(1, 0.55 + 0.45 * np.clip(tv / 0.05, 0, 1))  # 50 ms attack
        env = env * np.clip((m * FRAME_MS / 1000 - tv) / 0.09, 0.35, 1)  # 90 ms release
        cur = sp2[vi].sum(axis=1)
        gain = (target * env ** 2) / np.maximum(cur, 1e-16)
        sp2[vi] *= _smooth(gain[:, None], 3)

    # target pitch: soft glide from the previous note, gentle delayed vibrato
    tt = np.arange(len(idx)) * FRAME_MS / 1000.0
    target_hz = np.full(len(idx), midi_hz(pitch))
    if prev_pitch:
        g = np.clip((tt - onset_out * FRAME_MS / 1000) / max(0.03, min(0.08, dur * 0.25)), 0, 1)
        g = 0.5 - 0.5 * np.cos(np.pi * g)  # ease in/out
        target_hz *= 2 ** ((prev_pitch - pitch) * (1 - g) / 12)
    vib = opts.get("vibrato", 1)
    if vib > 0 and dur > 0.45:
        depth = 0.2 * vib * np.clip((tt - 0.3) / 0.4, 0, 1)
        target_hz *= 2 ** (depth * np.sin(2 * np.pi * 5.2 * tt) / 12)
    f0_new = np.where(voiced_mask, target_hz, 0.0)

    # formant shift (kid / chipmunk / monster voices) by warping the envelope
    kf = opts.get("formant", 1.0)
    if abs(kf - 1.0) > 1e-3:
        bins = sp2.shape[1]
        src = np.clip(np.arange(bins) / kf, 0, bins - 1)
        sp2 = np.stack([np.interp(src, np.arange(bins), row) for row in sp2])
        ap2 = np.stack([np.interp(src, np.arange(bins), row) for row in ap2])

    y = pw.synthesize(np.ascontiguousarray(f0_new), np.ascontiguousarray(sp2), np.ascontiguousarray(ap2), fs, FRAME_MS)
    return y, onset_out * FRAME_MS / 1000.0


def _fade(y, fs, fade_in, fade_out):
    """Raised-cosine fades so joins never click."""
    y = y.copy()
    a, b = min(len(y) // 2, int(fade_in * fs)), min(len(y) // 2, int(fade_out * fs))
    if a > 0:
        y[:a] *= 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, a))
    if b > 0:
        y[-b:] *= 0.5 + 0.5 * np.cos(np.linspace(0, np.pi, b))
    return y


def _rms(y):
    return float(np.sqrt(np.mean(y ** 2))) if len(y) else 0.0


def _polish(out, fs, reverb=0.16):
    """Warm tone (gentle treble roll-off), soft room reverb, peak normalize."""
    n = len(out)
    if n == 0:
        return out
    size = 1 << int(np.ceil(np.log2(n + fs * 2)))
    freqs = np.fft.rfftfreq(size, 1 / fs)
    # -5 dB high shelf above ~5 kHz, slight cut of rumble below 90 Hz
    shelf = 10 ** (-5 / 20 * np.clip((freqs - 3500) / 3000, 0, 1))
    shelf *= np.clip(freqs / 90, 0.2, 1)
    spec = np.fft.rfft(out, size) * shelf
    dry = np.fft.irfft(spec, size)
    if reverb > 0:
        rng = np.random.default_rng(7)
        L = int(1.3 * fs)
        ir = rng.standard_normal(L) * np.exp(-np.arange(L) / (0.28 * fs))
        ir = np.convolve(ir, np.ones(24) / 24, mode="same")  # darker tail
        ir[: int(0.012 * fs)] = 0  # pre-delay
        ir /= np.sqrt(np.sum(ir ** 2))
        wet = np.fft.irfft(np.fft.rfft(dry[:n], size) * np.fft.rfft(ir, size), size)
        dry = dry * (1 - reverb) + wet * reverb * 0.9
    y = dry[: n + int(0.6 * fs)]
    return y


def sing(kokoro, notes, bpm, voice, lang="en-us", opts=None):
    """Sing a line: the natural word-by-word method, or syllable-by-syllable if that fails."""
    try:
        return sing_phrase(kokoro, notes, bpm, voice, lang, opts)
    except Exception as err:  # odd input (e.g. unsplittable syllables): use the simpler method
        print(f"sing_phrase fell back: {err}", file=__import__("sys").stderr)
        return sing_syllables(kokoro, notes, bpm, voice, lang, opts)


def sing_syllables(kokoro, notes, bpm, voice, lang="en-us", opts=None):
    """notes: [{"text": "Twin", "word": 0, "pitch": 60, "beats": 1}, ...]; pitch 0 or empty text = rest.
    Returns (samples, fs) with note i starting exactly at its beat position."""
    opts = opts or {}
    spb = 60.0 / bpm
    transpose = opts.get("transpose", 0)

    # group notes into words and phonemize each word once
    words = {}
    for i, nt in enumerate(notes):
        if nt.get("text") and nt.get("pitch") and not nt.get("hold"):
            words.setdefault(nt.get("word", i), []).append(i)
    syllable_ipa = {}
    clean = lambda ipa: re.sub(r"[.,!?;:\"“”()]", "", ipa).replace(" ", "")
    for _, idxs in sorted(words.items()):
        texts = [re.sub(r"[^\w']", "", notes[i]["text"]) for i in idxs]
        chunks = split_syllables(clean(kokoro.tokenizer.phonemize("".join(texts), lang=lang)), len(idxs))
        if None in chunks:  # e.g. "E-I-E-I-O": the joined word has too few vowels, so say each part
            chunks = [clean(kokoro.tokenizer.phonemize(t, lang=lang)) or None for t in texts]
        for i, chunk in zip(idxs, chunks):
            syllable_ipa[i] = chunk

    total = sum(float(nt["beats"]) for nt in notes) * spb
    fs = 24000
    out = np.zeros(int(total * fs) + fs * 2)
    t = 0.0
    prev_pitch = None
    cache = {}
    last_audio = None
    rendered = []
    for i, nt in enumerate(notes):
        dur = float(nt["beats"]) * spb
        pitch = (nt.get("pitch") or 0)
        if not pitch or not nt.get("text"):
            t += dur
            prev_pitch = None
            continue
        pitch += transpose
        ipa = syllable_ipa.get(i)
        if nt.get("hold") or ipa is None:  # melisma: re-sing the previous vowel
            audio = last_audio
        else:
            if ipa not in cache:
                samples, sr = kokoro.create(ipa, voice=voice, speed=0.9, lang=lang, is_phonemes=True)
                cache[ipa] = samples
            audio = cache[ipa]
        if audio is None or len(audio) < 200:
            t += dur
            continue
        last_audio = audio
        # legato: each note rings slightly into the next and they cross-fade
        y, onset = render_note(audio, fs, dur + 0.04, pitch, prev_pitch, opts)
        rendered.append((t - onset, y))
        prev_pitch = pitch
        t += dur

    # even loudness from note to note (spoken syllables vary a lot)
    levels = [_rms(y) for _, y in rendered]
    ref = float(np.median([l for l in levels if l > 0])) if any(levels) else 1.0
    for (start, y), level in zip(rendered, levels):
        g = min(2.5, max(0.4, ref / level)) if level > 0 else 1.0
        y = _fade(y * g, fs, 0.012, 0.045)
        s = int(max(0.0, start) * fs)
        e = min(len(out), s + len(y))
        out[s:e] += y[: e - s]

    out = _polish(out[: int(total * fs) + int(0.6 * fs)], fs, reverb=opts.get("reverb", 0.16))
    out = out[: int(total * fs)]
    out = _fade(out, fs, 0.0, 0.08)
    peak = np.max(np.abs(out)) or 1.0
    return (out / peak * 0.89).astype(np.float32), fs


# ---------------------------------------------------------------------------
# Natural-phrase singer (default): Kokoro speaks the whole lyric line once, so
# sounds blend into each other like real speech. Syllable positions inside that
# phrase are found by aligning it (DTW) against the separately spoken
# syllables, then the phrase is re-timed onto the notes and re-pitched in one
# WORLD pass. No joins, natural transitions, steady pitch with a hint of the
# speaker's own intonation.
# ---------------------------------------------------------------------------

def _logmel(x, fs, hop, n_mels=30):
    win, nfft = int(0.025 * fs), 512
    if len(x) < win:
        x = np.pad(x, (0, win - len(x)))
    frames = 1 + (len(x) - win) // hop
    idx = np.arange(win)[None, :] + hop * np.arange(frames)[:, None]
    spec = np.abs(np.fft.rfft(x[idx] * np.hanning(win), nfft)) ** 2
    mel = lambda f: 2595 * np.log10(1 + f / 700)
    pts = 700 * (10 ** (np.linspace(mel(80), mel(fs / 2 * 0.9), n_mels + 2) / 2595) - 1)
    bins = np.floor((nfft + 1) * pts / fs).astype(int)
    fb = np.zeros((n_mels, nfft // 2 + 1))
    for m in range(1, n_mels + 1):
        a, b, c = bins[m - 1], bins[m], bins[m + 1]
        if b > a: fb[m - 1, a:b] = (np.arange(a, b) - a) / (b - a)
        if c > b: fb[m - 1, b:c] = (c - np.arange(b, c)) / (c - b)
    f = np.log(spec @ fb.T + 1e-10)
    return (f - f.mean(0)) / (f.std(0) + 1e-6)


def _dtw_map(ref, hyp):
    """Standard DTW. Returns, for every ref frame, the first hyp frame it aligns to."""
    n, m = len(ref), len(hyp)
    cost = np.sqrt(((ref[:, None, :] - hyp[None, :, :]) ** 2).sum(-1))
    D = np.full((n + 1, m + 1), np.inf)
    D[0, 0] = 0.0
    for i in range(1, n + 1):
        ci = cost[i - 1]
        prev = D[i - 1]
        row = D[i]
        # diagonal / vertical candidates are vectorized; the horizontal one is a running scan
        base = np.minimum(prev[:-1], prev[1:]) + ci
        acc = np.inf
        for j in range(1, m + 1):
            acc = min(base[j - 1], acc + ci[j - 1])
            row[j] = acc
    # backtrack
    i, j = n, m
    first = np.full(n, m - 1)
    while i > 0 and j > 0:
        first[i - 1] = j - 1
        moves = (D[i - 1, j - 1], D[i - 1, j], D[i, j - 1])
        k = int(np.argmin(moves))
        if k == 0: i, j = i - 1, j - 1
        elif k == 1: i -= 1
        else: j -= 1
    return np.minimum.accumulate(first[::-1])[::-1]


def _trim(y, fs, db=-38):
    e = np.abs(y)
    thr = e.max() * 10 ** (db / 20)
    on = np.where(e > thr)[0]
    if len(on) == 0:
        return y
    return y[max(0, on[0] - int(0.005 * fs)): on[-1] + int(0.01 * fs)]


def sing_phrase(kokoro, notes, bpm, voice, lang="en-us", opts=None):
    opts = opts or {}
    fs = 24000
    hop = int(FRAME_MS / 1000 * fs)
    spb = 60.0 / bpm
    transpose = opts.get("transpose", 0)

    # 1) syllables -> phonemes, grouped into "events" (a syllable plus any held notes)
    words = {}
    for i, nt in enumerate(notes):
        if nt.get("text") and nt.get("pitch") and not nt.get("hold"):
            words.setdefault(nt.get("word", i), []).append(i)
    clean = lambda ipa: re.sub(r"[.,!?;:\"“”()]", "", ipa).replace(" ", "")
    syl_ipa, word_ipa = {}, []
    for _, idxs in sorted(words.items()):
        texts = [re.sub(r"[^\w']", "", notes[i]["text"]) for i in idxs]
        chunks = split_syllables(clean(kokoro.tokenizer.phonemize("".join(texts), lang=lang)), len(idxs))
        if None in chunks:
            chunks = [clean(kokoro.tokenizer.phonemize(t, lang=lang)) or None for t in texts]
        if None in chunks:
            raise ValueError("could not split syllables")
        for i, c in zip(idxs, chunks):
            syl_ipa[i] = c
        word_ipa.append("".join(chunks))

    events = []  # {"syl": note index, "notes": [(start_s, dur_s, pitch)]}
    t = 0.0
    for i, nt in enumerate(notes):
        dur = float(nt["beats"]) * spb
        if nt.get("pitch") and nt.get("text"):
            if nt.get("hold") and events and abs(events[-1]["notes"][-1][0] + events[-1]["notes"][-1][1] - t) < 1e-6:
                events[-1]["notes"].append((t, dur, nt["pitch"] + transpose))
            elif i in syl_ipa:
                events.append({"syl": i, "notes": [(t, dur, nt["pitch"] + transpose)]})
        t += dur
    total = t
    if not events:
        return np.zeros(int(total * fs), np.float32), fs

    # 2) each word spoken naturally on its own; syllable boundaries inside a
    #    multi-syllable word come from aligning it with its separately spoken syllables
    say = lambda ipa: _trim(kokoro.create(ipa, voice=voice, speed=0.92, lang=lang, is_phonemes=True)[0].astype(np.float64), fs)
    cache = {}
    def spoken(ipa):
        if ipa not in cache:
            cache[ipa] = say(ipa)
        return cache[ipa]

    ev_of = {ev["syl"]: k for k, ev in enumerate(events)}
    gap = np.zeros(int(0.03 * fs))
    parts, seg_bounds, pos = [], [None] * len(events), 0
    for _, idxs in sorted(words.items()):
        idxs = [i for i in idxs if i in ev_of]
        if not idxs:
            continue
        w = spoken("".join(syl_ipa[i] for i in idxs))
        if len(idxs) == 1:
            cuts = [0, len(w)]
        else:
            pieces = [spoken(syl_ipa[i]) for i in idxs]
            ref = np.concatenate(pieces)
            starts = np.cumsum([0] + [len(p) for p in pieces[:-1]])
            path = _dtw_map(_logmel(ref, fs, hop), _logmel(w, fs, hop))
            cuts = [0] + [int(path[min(len(path) - 1, st // hop)]) * hop for st in starts[1:]] + [len(w)]
            cuts = list(np.maximum.accumulate(cuts))
        for j, i in enumerate(idxs):
            seg_bounds[ev_of[i]] = ((pos + cuts[j]) // hop, (pos + cuts[j + 1]) // hop)
        parts += [w, gap]; pos += len(w) + len(gap)
    phrase = np.concatenate(parts) if parts else np.zeros(fs)
    seg = [b[0] if b else 0 for b in seg_bounds]
    ends = [b[1] if b else 0 for b in seg_bounds]

    # 3) analyse the words once
    f0, tt = pw.harvest(phrase, fs, f0_floor=70, f0_ceil=800, frame_period=FRAME_MS)
    sp = pw.cheaptrick(phrase, f0, tt, fs)
    ap = pw.d4c(phrase, f0, tt, fs)
    n = len(f0)
    energy = sp.sum(1)

    # 4) build the output->source frame map, note by note
    out_n = int(round(total * 1000 / FRAME_MS)) + 1
    src = np.full(out_n, -1.0)       # -1 = silence
    vowel = np.zeros(out_n, bool)
    gain = np.ones(out_n)
    f0_target = np.zeros(out_n)
    lin = lambda p, q, m: np.linspace(p, q, m) if m > 0 else np.array([], dtype=float)
    fr_of = lambda s: int(round(s * 1000 / FRAME_MS))

    # per-syllable source regions
    regions = []
    for k, ev in enumerate(events):
        a = int(min(seg[k], n - 2)); b = int(max(a + 2, min(ends[k], n)))
        v = np.where(f0[a:b] > 0)[0]
        if len(v) >= 2:
            v0, v1 = a + v[0], a + v[-1] + 1
        else:  # no voicing found: treat the middle as the vowel
            v0, v1 = a + (b - a) // 3, a + 2 * (b - a) // 3 + 1
        # the steady part to hold: grow outward from the loudest frame while it stays loud
        core = energy[v0:v1]
        if len(core) >= 2:
            peak = int(np.argmax(core)); thr = 0.45 * core[peak]
            l = peak
            while l > 0 and core[l - 1] >= thr: l -= 1
            r = peak
            while r < len(core) - 1 and core[r + 1] >= thr: r += 1
            s0, s1 = v0 + l, v0 + r + 1
            if s1 - s0 < 2: s0, s1 = v0, v1
        else:
            s0, s1 = v0, v1
        level = float(np.median(energy[s0:s1]))
        regions.append(dict(a=a, b=b, v0=v0, v1=v1, s0=s0, s1=s1, level=level))
    ref_level = float(np.median([r["level"] for r in regions]))

    for k, (ev, r) in enumerate(zip(events, regions)):
        n_start = fr_of(ev["notes"][0][0])
        n_end = fr_of(ev["notes"][-1][0] + ev["notes"][-1][1])
        span = n_end - n_start
        onset = min(r["v0"] - r["a"], int(140 / FRAME_MS), int(span * 0.35))
        coda = min(r["b"] - r["v1"], int(120 / FRAME_MS), int(span * 0.25))
        o0 = max(0, n_start - onset)
        # next syllable's consonants borrow the end of this note
        nxt = events[k + 1] if k + 1 < len(events) else None
        if nxt is not None and abs(fr_of(nxt["notes"][0][0]) - n_end) <= 1:
            nr = regions[k + 1]
            nxt_on = min(nr["v0"] - nr["a"], int(140 / FRAME_MS), int((fr_of(nxt["notes"][-1][0] + nxt["notes"][-1][1]) - n_end) * 0.35))
            v_end = n_end - nxt_on
        else:
            v_end = n_end + int(0.03 * 1000 / FRAME_MS)  # ring slightly into a rest
        v_end = min(v_end, out_n - coda)
        vs = n_start
        vlen = max(2, v_end - coda - vs)
        att, rel = max(1, int(vlen * 0.12)), max(1, int(vlen * 0.12))
        hold = max(1, vlen - att - rel)
        vowel_map = np.concatenate([lin(r["v0"], r["s0"], att), lin(r["s0"], max(r["s0"], r["s1"] - 1), hold),
                                    lin(max(r["s0"], r["s1"] - 1), r["v1"] - 1, rel)])
        mapping = np.concatenate([lin(r["v0"] - onset, r["v0"] - 1, n_start - o0), vowel_map, lin(r["v1"], r["v1"] + coda - 1, coda)])
        e = min(out_n, o0 + len(mapping))
        src[o0:e] = mapping[: e - o0]
        vowel[vs:min(out_n, vs + len(vowel_map))] = True
        g = (ref_level / max(r["level"], 1e-16)) ** 0.85
        gain[o0:e] = min(6.0, max(0.25, g))
        for (ns, nd, p) in ev["notes"]:
            f0_target[fr_of(ns):min(out_n, fr_of(ns + nd) + 1)] = midi_hz(p)
        f0_target[o0:fr_of(ev["notes"][0][0])] = midi_hz(ev["notes"][0][2])
        # sustain the target through the coda region
        f0_target[min(out_n - 1, fr_of(ev["notes"][-1][0] + ev["notes"][-1][1])):e] = midi_hz(ev["notes"][-1][2])

    # 5) warp the phrase's envelopes onto the output timeline
    active = src >= 0
    s_clip = np.clip(src, 0, n - 1)
    lo = np.floor(s_clip).astype(int); hi = np.minimum(lo + 1, n - 1); w = (s_clip - lo)[:, None]
    logsp = np.log(sp + 1e-16)
    sp2 = np.exp(logsp[lo] * (1 - w) + logsp[hi] * w)
    ap2 = ap[lo] * (1 - w) + ap[hi] * w
    vo = (f0[lo] > 0) | (f0[hi] > 0) | vowel
    # light smoothing everywhere, more on held vowels
    sp2 = np.exp(_smooth(np.log(sp2), 1))
    if vowel.any():
        vi = np.where(vowel)[0]
        sp2[vi] = np.exp(_smooth(np.log(sp2[vi]), 3))
    ap2 = np.clip(_smooth(ap2, 3), 0.0, 0.85)
    bins = ap2.shape[1]
    freqs = np.arange(bins) * (fs / 2) / (bins - 1)
    low_cap = np.interp(freqs, [0, 1000, 3000, fs / 2], [0.2, 0.3, 0.85, 0.85])
    ap2[vowel] = np.minimum(ap2[vowel], low_cap)
    # even loudness across syllables (spoken stress varies a lot)
    sp2 *= _smooth(gain[:, None], 4)
    silent = ~active
    sp2[silent] = 1e-16; ap2[silent] = 1.0; vo[silent] = False

    # 6) pitch: note targets with eased transitions, a hint of the speaker's own
    #    intonation, and (optionally) a very light vibrato on long notes
    tgt_semi = np.where(f0_target > 0, 12 * np.log2(np.maximum(f0_target, 1) / 440), np.nan)
    idx = np.arange(out_n)
    good = ~np.isnan(tgt_semi)
    if good.any():
        tgt_semi = np.interp(idx, idx[good], tgt_semi[good])
    tgt_semi = _smooth(tgt_semi[:, None], 6)[:, 0]  # ~60 ms eased glides
    orig = f0[lo]
    on = orig > 0
    human = np.zeros(out_n)
    if on.sum() > 10:
        osemi = 12 * np.log2(np.where(on, orig, np.median(orig[on])) / np.median(orig[on]))
        trend = _smooth(osemi[:, None], 25)[:, 0]
        human = np.clip(_smooth((osemi - trend)[:, None], 3)[:, 0], -1, 1) * 0.15
    vib = np.zeros(out_n)
    if opts.get("vibrato", 1) > 0:
        for ev in events:
            for (ns, nd, _p) in ev["notes"]:
                if nd >= 0.9:
                    a0, a1 = fr_of(ns), min(out_n, fr_of(ns + nd))
                    tl = np.arange(a1 - a0) * FRAME_MS / 1000
                    vib[a0:a1] = 0.1 * opts.get("vibrato", 1) * np.clip((tl - 0.45) / 0.4, 0, 1) * np.sin(2 * np.pi * 5.0 * tl)
    f0_new = np.where(vo, 440 * 2 ** ((tgt_semi + human + vib) / 12), 0.0)
    if isinstance(opts.get("debug"), dict):
        opts["debug"].update(src=src, f0_new=f0_new, vowel=vowel, seg=seg, ends=ends, regions=regions, vo=vo, energy=sp2.sum(1))

    kf = opts.get("formant", 1.0)
    if abs(kf - 1.0) > 1e-3:
        srcb = np.clip(np.arange(bins) / kf, 0, bins - 1)
        sp2 = np.stack([np.interp(srcb, np.arange(bins), row) for row in sp2])
        ap2 = np.stack([np.interp(srcb, np.arange(bins), row) for row in ap2])

    y = pw.synthesize(np.ascontiguousarray(f0_new), np.ascontiguousarray(sp2), np.ascontiguousarray(ap2), fs, FRAME_MS)
    y = _polish(y[: int(total * fs) + int(0.6 * fs)], fs, reverb=opts.get("reverb", 0.12))[: int(total * fs)]
    y = _fade(y, fs, 0.0, 0.04)
    peak = np.max(np.abs(y)) or 1.0
    return (y / peak * 0.89).astype(np.float32), fs
