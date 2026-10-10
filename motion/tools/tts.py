"""Generate narration clips with Kokoro and build timeline.json from their real durations."""
import json, sys, os
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

MODEL_DIR = sys.argv[1]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VOICE = os.environ.get("VOICE", "af_heart")
SPEED = float(os.environ.get("SPEED", "1.05"))

k = Kokoro(f"{MODEL_DIR}/kokoro-v1.0.onnx", f"{MODEL_DIR}/voices-v1.0.bin")
script = json.load(open(f"{ROOT}/tools/script.json"))
SR = 24000
t = 0.0
timeline = {"scenes": [], "voice": VOICE}
full = []
for sc in script:
    start = t
    t += sc["lead"]
    cues = []
    for i, (text, gap) in enumerate(sc["lines"]):
        samples, sr = k.create(text, voice=VOICE, speed=SPEED, lang="en-us")
        assert sr == SR
        # trim leading/trailing silence
        nz = np.where(np.abs(samples) > 0.01)[0]
        samples = samples[max(0, nz[0] - 240): nz[-1] + 1200]
        d = len(samples) / SR
        cues.append({"t": round(t, 3), "d": round(d, 3), "text": text})
        full.append((t, samples))
        t += d + gap
    t += sc["tail"]
    timeline["scenes"].append({"id": sc["id"], "start": round(start, 3), "end": round(t, 3), "cues": cues})
    print(f'{sc["id"]}: {start:6.2f} -> {t:6.2f}  ({t-start:.2f}s)')
timeline["duration"] = round(t, 3)
buf = np.zeros(int((t + 0.5) * SR), dtype=np.float32)
for st, s in full:
    i = int(st * SR); buf[i:i + len(s)] += s
sf.write(f"{ROOT}/audio/voice.wav", buf, SR)
json.dump(timeline, open(f"{ROOT}/timeline.json", "w"), indent=1)
print("total", round(t, 2))
