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


def render_note(audio, fs, dur, pitch, prev_pitch, opts):
    """Return (samples, onset_seconds) for one syllable sung at `pitch` for `dur` seconds."""
    x = audio.astype(np.float64)
    f0, t = pw.dio(x, fs, f0_floor=60, f0_ceil=700, frame_period=FRAME_MS)
    f0 = pw.stonemask(x, f0, t, fs)
    sp = pw.cheaptrick(x, f0, t, fs)
    ap = pw.d4c(x, f0, t, fs)
    n = len(f0)
    voiced = np.where(f0 > 0)[0]
    if len(voiced) == 0:  # e.g. a bare consonant: keep as is
        return x, 0.0
    v0, v1 = voiced[0], voiced[-1] + 1
    onset = min(v0, int(150 / FRAME_MS))
    coda = min(n - v1, int(150 / FRAME_MS))
    start = v0 - onset
    total = max(int(round(dur * 1000 / FRAME_MS)), 6)
    # consonants keep their natural length unless the note is short; then they
    # are squeezed so the whole syllable fits and the vowel keeps half the note
    k = min(1.0, 0.5 * total / max(1, onset + coda))
    onset_out, coda_out = int(round(onset * k)), int(round(coda * k))
    mid = max(2, total - onset_out - coda_out)
    lin = lambda a, b, m: np.linspace(a, b, m) if m > 0 and b >= a else np.array([], dtype=float)
    idx = np.concatenate([lin(start, v0 - 1, onset_out), lin(v0, v1 - 1, mid), lin(v1, v1 + coda - 1, coda_out)])
    lo = np.floor(idx).astype(int).clip(0, n - 1)
    hi = (lo + 1).clip(0, n - 1)
    w = (idx - lo)[:, None]
    sp2 = sp[lo] * (1 - w) + sp[hi] * w
    ap2 = ap[lo] * (1 - w) + ap[hi] * w
    was_voiced = (f0[lo] > 0) | (f0[hi] > 0)

    # target pitch: glide from the previous note, then vibrato after a short delay
    tt = np.arange(len(idx)) * FRAME_MS / 1000.0
    target = np.full(len(idx), midi_hz(pitch))
    if prev_pitch:
        glide = np.clip((tt - onset_out * FRAME_MS / 1000) / min(0.06, dur * 0.2), 0, 1)
        semis = (prev_pitch - pitch) * (1 - glide)
        target *= 2 ** (semis / 12)
    if opts.get("vibrato", 1) > 0 and dur > 0.35:
        depth = 0.35 * opts.get("vibrato", 1) * np.clip((tt - 0.25) / 0.3, 0, 1)
        target *= 2 ** (depth * np.sin(2 * np.pi * 5.5 * tt) / 12)
    f0_new = np.where(was_voiced, target, 0.0)

    # formant shift (kid / chipmunk / monster voices) by warping the envelope
    k = opts.get("formant", 1.0)
    if abs(k - 1.0) > 1e-3:
        bins = sp2.shape[1]
        src = np.clip(np.arange(bins) / k, 0, bins - 1)
        sp2 = np.stack([np.interp(src, np.arange(bins), row) for row in sp2])
        ap2 = np.stack([np.interp(src, np.arange(bins), row) for row in ap2])

    y = pw.synthesize(np.ascontiguousarray(f0_new), np.ascontiguousarray(sp2), np.ascontiguousarray(ap2), fs, FRAME_MS)
    return y, onset_out * FRAME_MS / 1000.0


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
    out = np.zeros(int(total * fs) + fs)
    t = 0.0
    prev_pitch = None
    cache = {}
    last_audio = None
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
        # leave a tiny breath between notes so syllables don't smear together
        y, onset = render_note(audio, fs, max(0.12, dur - 0.03), pitch, prev_pitch, opts)
        y = y * np.minimum(1, np.minimum(np.arange(len(y)), np.arange(len(y))[::-1]) / (0.008 * fs))  # 8 ms fades
        s = int(max(0.0, t - onset) * fs)
        e = min(len(out), s + len(y))
        out[s:e] += y[: e - s]
        prev_pitch = pitch
        t += dur
    out = out[: int(total * fs)]
    peak = np.max(np.abs(out)) or 1.0
    return (out / peak * 0.9).astype(np.float32), fs
