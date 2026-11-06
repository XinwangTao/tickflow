"""Offline speech-to-text for TickFlow voice quick-add (Vosk).

Usage:
    python asr_transcribe.py --model <vosk-model-dir> <audio.wav>

Prints one JSON line: {"text": "...", "segments": [...]}. Input must be
16 kHz mono PCM WAV (the Electron side converts with ffmpeg).

Kept as a standalone script on purpose: the model and the vosk wheel live
outside the app bundle, so the desktop build stays free of a 60 MB runtime it
only needs when the user taps the mic.
"""
from __future__ import annotations

import argparse
import json
import sys
import wave


def transcribe(model_dir: str, wav_path: str) -> dict:
    import vosk

    vosk.SetLogLevel(-1)
    model = vosk.Model(model_dir)
    rec = vosk.KaldiRecognizer(model, 16000)
    rec.SetWords(False)
    segments: list[str] = []
    with wave.open(wav_path, "rb") as wf:
        if wf.getnchannels() != 1 or wf.getsampwidth() != 2:
            raise SystemExit("expected 16-bit mono wav")
        while True:
            data = wf.readframes(4000)
            if not data:
                break
            if rec.AcceptWaveform(data):
                text = json.loads(rec.Result()).get("text", "")
                if text:
                    segments.append(text)
    tail = json.loads(rec.FinalResult()).get("text", "")
    if tail:
        segments.append(tail)
    return {"text": "".join(segments).replace(" ", ""), "segments": segments}


def main() -> int:
    # Windows consoles default to GBK; the Electron side always reads UTF-8.
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("wav")
    args = ap.parse_args()
    try:
        out = transcribe(args.model, args.wav)
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller as JSON
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
