"""
Пакетный синтез речи Silero. Вызывается из scripts/voice.mjs.

    python scripts/silero_tts.py job.json

job.json: {"model": "...v4_ru.pt", "speaker": "aidar", "sampleRate": 48000,
           "items": [{"ssml": "<speak>...</speak>", "out": "path.wav"}, ...]}

Модель грузится один раз на весь пакет — поэтому реплики синтезируются
скопом, а не по одной на запуск процесса.
"""
import json
import sys
import wave

import torch
from torch import package


def main() -> int:
    job = json.load(open(sys.argv[1], encoding="utf-8"))
    items = job["items"]
    if not items:
        return 0

    torch.set_num_threads(job.get("threads", 4))
    importer = package.PackageImporter(job["model"])
    model = importer.load_pickle("tts_models", "model")
    model.to(torch.device("cpu"))

    rate = job.get("sampleRate", 48000)
    for i, item in enumerate(items, 1):
        kwargs = {"ssml_text": item["ssml"]} if item.get("ssml") else {"text": item["text"]}
        try:
            audio = model.apply_tts(
                speaker=job["speaker"], sample_rate=rate,
                put_accent=True, put_yo=True, **kwargs,
            )
        except Exception as exc:                       # SSML может не свариться — читаем как обычный текст
            print(f"! ssml не принят ({exc}), читаю без разметки", file=sys.stderr)
            audio = model.apply_tts(
                text=item["text"], speaker=job["speaker"], sample_rate=rate,
                put_accent=True, put_yo=True,
            )
        with wave.open(item["out"], "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes((audio.numpy() * 32767).astype("int16").tobytes())
        print(f"{i}/{len(items)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
