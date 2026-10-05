"""Long-running Kokoro TTS worker.

Reads one JSON request per line on stdin:
  {"id": 1, "text": "...", "voice": "af_heart", "lang": "en-us", "speed": 1.0, "out": "/tmp/x.wav"}
and writes one JSON response per line on stdout:
  {"id": 1, "ok": true, "duration": 2.4}  or  {"id": 1, "ok": false, "error": "..."}
The model is loaded once, so each request only pays for synthesis.
"""
import json
import os
import sys

import soundfile as sf
from kokoro_onnx import Kokoro

here = os.path.dirname(os.path.abspath(__file__))
models = os.environ.get("KOKORO_DIR", os.path.join(here, "..", "models"))
model = os.environ.get("KOKORO_MODEL", os.path.join(models, "kokoro-v1.0.int8.onnx"))
voices = os.environ.get("KOKORO_VOICES", os.path.join(models, "voices-v1.0.bin"))

kokoro = Kokoro(model, voices)
print(json.dumps({"ready": True, "voices": kokoro.get_voices()}), flush=True)

for line in sys.stdin:
    if not line.strip():
        continue
    req = {}
    try:
        req = json.loads(line)
        samples, rate = kokoro.create(
            req["text"], voice=req["voice"], speed=float(req.get("speed", 1.0)), lang=req.get("lang", "en-us")
        )
        sf.write(req["out"], samples, rate)
        print(json.dumps({"id": req["id"], "ok": True, "duration": len(samples) / rate}), flush=True)
    except Exception as e:  # report and keep serving
        print(json.dumps({"id": req.get("id"), "ok": False, "error": str(e)}), flush=True)
