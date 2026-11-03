import json
import os
import sys
from faster_whisper import WhisperModel

model = WhisperModel(os.environ.get("STUDYAI_WHISPER_MODEL", "base.en"), device="cpu", compute_type="int8")
segments, info = model.transcribe(sys.argv[1], beam_size=3, vad_filter=True)
print(json.dumps({
    "language": info.language,
    "segments": [
        {"start": round(segment.start, 2), "end": round(segment.end, 2), "text": segment.text.strip()}
        for segment in segments if segment.text.strip()
    ],
}))

