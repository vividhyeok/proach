"""Wrapper around ElevenLabs Scribe v1 speech-to-text."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, Optional

from dotenv import load_dotenv
from elevenlabs import ElevenLabs


class Transcriber:
    """Simple helper that converts audio files via ElevenLabs Scribe v1."""

    def __init__(self, api_key: Optional[str] = None, language_code: Optional[str] = None):
        load_dotenv()
        api_key = api_key or os.getenv("ELEVENLABS_API_KEY")
        if not api_key:
            raise RuntimeError("ELEVENLABS_API_KEY is missing. Populate .env first.")
        self.client = ElevenLabs(api_key=api_key)
        self.language_code = language_code or os.getenv("DEFAULT_LANGUAGE_CODE", "kor")

    def transcribe(self, audio_path: Path) -> Dict[str, object]:
        audio_path = Path(audio_path)
        if not audio_path.exists():
            raise FileNotFoundError(audio_path)
        with audio_path.open("rb") as fh:
            try:
                return self.client.speech_to_text.convert(
                    file=fh,
                    model_id="scribe_v1",
                    tag_audio_events=False,
                    language_code=self.language_code,
                    diarize=False,
                )
            except Exception as exc:
                raise RuntimeError(f"Transcription failed: {exc}") from exc
