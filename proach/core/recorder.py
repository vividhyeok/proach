"""Audio recording utilities based on sounddevice."""

from __future__ import annotations

import queue
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
import sounddevice as sd


@dataclass
class RecorderConfig:
    samplerate: int = 44100
    channels: int = 1
    dtype: str = "int16"
    blocksize: int = 1024


class Recorder:
    """Minimal recorder that writes microphone input to a WAV file."""

    def __init__(self, config: Optional[RecorderConfig] = None):
        self.config = config or RecorderConfig()
        self._queue: "queue.Queue[np.ndarray]" = queue.Queue()
        self._stream: Optional[sd.InputStream] = None
        self._frames_written = 0
        self._output_path: Optional[Path] = None

    # ------------------------------------------------------------------
    def start(self, output_path: Path) -> None:
        if self._stream is not None:
            raise RuntimeError("Recorder is already running")
        self._output_path = Path(output_path)
        self._queue = queue.Queue()
        self._frames_written = 0
        self._stream = sd.InputStream(
            samplerate=self.config.samplerate,
            channels=self.config.channels,
            dtype=self.config.dtype,
            blocksize=self.config.blocksize,
            callback=self._on_data,
        )
        self._stream.start()

    def stop(self) -> float:
        if self._stream is None or self._output_path is None:
            raise RuntimeError("Recorder is not running")
        self._stream.stop()
        self._stream.close()
        self._stream = None

        samples = []
        while not self._queue.empty():
            samples.append(self._queue.get())
        if not samples:
            raise RuntimeError("No audio captured")

        audio = np.concatenate(samples, axis=0)
        duration_sec = len(audio) / float(self.config.samplerate)
        self._write_wav(audio)
        return duration_sec

    # ------------------------------------------------------------------
    def _on_data(self, indata, frames, _time, status):
        if status:
            print(f"Recorder warning: {status}")
        self._queue.put(indata.copy())
        self._frames_written += frames

    def _write_wav(self, audio: np.ndarray) -> None:
        assert self._output_path is not None
        self._output_path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(self._output_path), "wb") as wf:
            wf.setnchannels(self.config.channels)
            wf.setsampwidth(2)  # int16
            wf.setframerate(self.config.samplerate)
            wf.writeframes(audio.tobytes())
