"""Synthesize music bed + SFX synced to timeline.json and mix with the narration."""
import json, os, numpy as np, soundfile as sf
from scipy.signal import butter, sosfilt, fftconvolve, resample_poly

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SR = 48000
tl = json.load(open(f"{ROOT}/timeline.json"))
SC = {s["id"]: s for s in tl["scenes"]}
DUR = tl["duration"] + 0.2
N = int(DUR * SR)
t = np.arange(N) / SR
rng = np.random.default_rng(5)

def lp(x, f, o=2): return sosfilt(butter(o, f, 'low', fs=SR, output='sos'), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, 'high', fs=SR, output='sos'), x)
def bp(x, a, b, o=2): return sosfilt(butter(o, [a, b], 'band', fs=SR, output='sos'), x)
def mtof(m): return 440 * 2 ** ((m - 69) / 12)
def env_adsr(n, a, r):
    e = np.ones(n); ai = int(a * SR); ri = int(r * SR)
    e[:ai] = np.linspace(0, 1, ai); e[-ri:] *= np.linspace(1, 0, ri); return e
def add(buf, x, at, gain=1.0):
    i = int(at * SR); j = min(N, i + len(x))
    if i >= N: return
    if i < 0: x = x[-i:]; i = 0
    buf[i:j] += x[:j - i] * gain
def saw(f, n, ph=0):
    tt = np.arange(n) / SR; return 2 * ((tt * f + ph) % 1) - 1

risks = (SC["s8"]["start"], SC["s8"]["end"])
BPM = 96; beat = 60 / BPM; bar = beat * 4
# chords (midi) — Am, F, C, G ; darker set for risks
prog = [[57, 60, 64, 69], [53, 57, 60, 65], [55, 60, 64, 67], [55, 59, 62, 67]]
dark = [[56, 59, 62, 65], [53, 56, 60, 63]]
bass = [45, 41, 48, 43]; dbass = [44, 41]

pad = np.zeros(N); bassL = np.zeros(N); arp = np.zeros(N)
chord_len = bar * 2
k = 0; ct = 0.0
while ct < DUR:
    n = int(chord_len * SR) + int(0.6 * SR)
    in_r = risks[0] - .3 <= ct < risks[1] - .3
    ch = (dark[k % 2] if in_r else prog[k % 4]); bn = (dbass[k % 2] if in_r else bass[k % 4])
    x = np.zeros(n)
    for m in ch:
        for d in (-0.08, 0.08):
            x += saw(mtof(m) * 2 ** (d / 12), n, rng.random()) * .12
    x = lp(x, 1400 if not in_r else 900) * env_adsr(n, 1.2, .9)
    add(pad, x, ct)
    b = (np.sin(2 * np.pi * mtof(bn - 12) * np.arange(n) / SR) * .6 + lp(saw(mtof(bn - 12), n), 300) * .4) * env_adsr(n, .05, .6)
    add(bassL, b, ct)
    # arpeggio 16ths
    for s in range(int(chord_len / (beat / 2))):
        at = ct + s * beat / 2
        m = ch[[0, 1, 2, 3, 2, 1][s % 6]] + 12
        nn = int(.22 * SR); tt = np.arange(nn) / SR
        note = (np.sin(2 * np.pi * mtof(m) * tt) + .3 * np.sin(2 * np.pi * mtof(m) * 2 * tt)) * np.exp(-tt * 14)
        add(arp, note, at, .5)
    ct += chord_len; k += 1

# drums (enter after intro, drop out during s3 question + end ring)
drums = np.zeros(N)
def kick():
    nn = int(.45 * SR); tt = np.arange(nn) / SR
    f = 42 + 90 * np.exp(-tt * 28); ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-tt * 7.5)
def hat():
    nn = int(.06 * SR); return hp(rng.standard_normal(nn), 7000) * np.exp(-np.arange(nn) / SR * 70)
K, Hh = kick(), hat()
d0 = SC["s1"]["end"]; mute = [(SC["s3"]["start"], SC["s3"]["end"]), (SC["end"]["start"] + .2, DUR)]
bt = d0
while bt < DUR:
    if not any(a <= bt < b for a, b in mute):
        add(drums, K, bt, .9)
        add(drums, Hh, bt + beat / 2, .22)
        if (round((bt - d0) / beat)) % 4 == 3: add(drums, Hh, bt + beat * .75, .12)
    bt += beat

music = pad * .55 + bassL * .5 + lp(arp, 3500) * .16 + drums * .55
# fade in from intro
music *= np.clip(t / 2.5, 0, 1)
# reverb
ir_n = int(2.4 * SR); ir = rng.standard_normal(ir_n) * np.exp(-np.arange(ir_n) / SR * 2.6); ir = lp(ir, 5000)
music = music + fftconvolve(music, ir)[:N] * .012

# SFX
sfx = np.zeros(N)
def riser(d=1.4):
    nn = int(d * SR); tt = np.arange(nn) / SR; x = rng.standard_normal(nn)
    out = np.zeros(nn); seg = 2048
    for i in range(0, nn, seg):
        f = 300 + 6000 * (i / nn) ** 2
        out[i:i + seg] = bp(x[i:i + seg], f, f * 1.8, 1)
    return out * (tt / d) ** 2 * .9
def impact():
    nn = int(2.2 * SR); tt = np.arange(nn) / SR
    f = 30 + 70 * np.exp(-tt * 9); boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 2.2)
    crash = hp(rng.standard_normal(nn), 2500) * np.exp(-tt * 3.5) * .25
    return boom + crash
def whoosh(d=0.9):
    nn = int(d * SR); tt = np.arange(nn) / SR; x = rng.standard_normal(nn)
    return bp(x, 400, 3000) * np.sin(np.pi * tt / d) ** 2 * .7
R, I, Wh = riser(), impact(), whoosh()
for s in tl["scenes"][1:]:
    add(sfx, R, s["start"] - 1.4, .35)
    add(sfx, I, s["start"] - .02, .5)
    add(sfx, Wh, s["start"] - .5, .45)
# intro: big warp whoosh + landing hit
add(sfx, riser(2.6), 0.2, .5)
add(sfx, impact(), 2.85, .8)
# glitch for risks
g = np.zeros(int(.6 * SR))
for i in range(0, len(g), 1200):
    if rng.random() < .55: g[i:i + 900] = np.sign(np.sin(np.arange(900) * rng.uniform(.05, .4))) * rng.uniform(.2, .6)
add(sfx, lp(g, 6000), SC["s8"]["start"] - .15, .35)
# counter ticks in key numbers
for ci in (3, 4):
    st = SC["s4"]["cues"][ci]["t"] + .1
    for j in range(14):
        nn = int(.02 * SR); tick = hp(rng.standard_normal(nn), 4000) * np.exp(-np.arange(nn) / SR * 300)
        add(sfx, tick, st + 1.6 * (1 - (1 - j / 14) ** 2), .25)
# end: shimmer
nn = int(4 * SR); tt = np.arange(nn) / SR
shim = sum(np.sin(2 * np.pi * mtof(m) * tt) for m in (81, 84, 88, 93)) * np.exp(-tt * 1.2) * .06
add(sfx, shim, SC["end"]["start"] + .1)

# voice
v, vsr = sf.read(f"{ROOT}/audio/voice.wav")
v = resample_poly(v, SR, vsr)
voice = np.zeros(N); voice[:min(N, len(v))] = v[:N]
voice = hp(voice, 70)
voice = voice / (np.max(np.abs(voice)) + 1e-9) * .85
# duck music under voice
envv = np.abs(voice); win = int(.25 * SR)
cs = np.concatenate([[0], np.cumsum(envv)]); idx = np.arange(N)
envv = (cs[np.clip(idx + win // 2, 0, N)] - cs[np.clip(idx - win // 2, 0, N)]) / win
duck = 1 - .55 * np.clip(envv / .06, 0, 1)
music = music / (np.max(np.abs(music)) + 1e-9) * .32 * duck
sfx = sfx / (np.max(np.abs(sfx)) + 1e-9) * .4
mix = voice + music + sfx
# final fade + soft limiter
mix *= np.clip((DUR - t) / 1.2, 0, 1)
mix = np.tanh(mix * 1.15) / np.tanh(1.15)
st = np.stack([mix, mix], 1)
# subtle stereo width on music/sfx
st[:, 0] += np.roll(music + sfx, 240) * .08; st[:, 1] -= np.roll(music + sfx, 240) * .08
st /= max(1, np.max(np.abs(st)) / .98)
sf.write(f"{ROOT}/audio/mix.wav", st.astype(np.float32), SR)
print("ok", DUR)
