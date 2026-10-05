"""Turns Kokoro speech into singing.

Each syllable is spoken by Kokoro (from IPA phonemes), then the WORLD
vocoder re-times it to its note length and replaces its pitch with the
melody note (plus vibrato and a short glide), the way a vocal tuner does.
Consonants stay natural length and land just before the beat so the vowel
starts on the beat.
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
