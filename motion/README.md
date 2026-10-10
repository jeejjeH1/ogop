# Startale Bond × JPYSC — motion graphic (16:9, with voiceover)

A 1920×1080 Twitter/X video built as a Three.js scene (3D extruded Startale and JPYSC logos, a 3D bond card and a 3D "5%"), with kinetic typography synced to a narrated script.

## Pipeline
1. `tools/script.json` holds the narration, split into sentences per scene.
2. `python3 tools/tts.py <kokoro-model-dir>` generates the voice with Kokoro TTS (`af_heart`) and writes `timeline.json` (the real cue times) plus `audio/voice.wav`.
3. `python3 tools/music.py` synthesizes the music bed and SFX on the same timeline, ducks them under the voice and writes `audio/mix.wav`.
4. Serve this folder (`python3 -m http.server 8123`) and run `node tools/capture.js out.mp4 30 [from] [to]` to render frames deterministically with headless Chromium.
5. Mux: `ffmpeg -i video.mp4 -i audio/mix.wav -c:v copy -c:a aac -b:a 192k -shortest final.mp4`.

Open `index.html?t=24` to preview any single moment, or `index.html` to play it in real time.
