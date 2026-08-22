"""
Пакетный синтез речи XTTS-v2. Вызывается из scripts/voice.mjs.

    python scripts/xtts_tts.py job.json

job.json: {"speaker": "Lidiya Szekeres", "language": "ru",
           "items": [{"text": "...", "speed": 1.08, "out": "path.wav"}, ...]}

Модель (~2 ГБ) грузится один раз на весь пакет — поэтому реплики синтезируются
скопом. SSML XTTS не понимает, эмоция передаётся темпом речи (speed).
"""
import json
import os
import sys

os.environ.setdefault("COQUI_TOS_AGREED", "1")


def main() -> int:
    job = json.load(open(sys.argv[1], encoding="utf-8"))
    items = job["items"]
    if not items:
        return 0

    from TTS.api import TTS

    tts = TTS(job.get("model", "tts_models/multilingual/multi-dataset/xtts_v2"))
    language = job.get("language", "ru")

    for i, item in enumerate(items, 1):
        tts.tts_to_file(
            text=item["text"],
            speaker=job["speaker"],
            language=language,
            speed=item.get("speed", 1.0),
            file_path=item["out"],
        )
        print(f"{i}/{len(items)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
