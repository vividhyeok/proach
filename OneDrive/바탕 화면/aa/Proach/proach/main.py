"""Application entry point."""

from __future__ import annotations

import sys
from pathlib import Path

from PyQt6.QtWidgets import QApplication

from .core.recorder import Recorder
from .core.storage import SessionStorage
from .core.transcriber import Transcriber
from .ui.main_window import MainWindow


def main() -> None:
    app = QApplication(sys.argv)

    storage = SessionStorage(Path(__file__).parent / "sessions")
    recorder = Recorder()
    try:
        transcriber = Transcriber()
    except RuntimeError as exc:
        print(f"Transcriber disabled: {exc}")
        transcriber = None

    window = MainWindow(storage=storage, recorder=recorder, transcriber=transcriber)
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
