"""Main window wiring session management with the practice view."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from PyQt6.QtWidgets import QFileDialog, QMainWindow, QMessageBox

from ..core.analysis import AnalysisEngine
from ..core.recorder import Recorder
from ..core.storage import SessionStorage
from ..core.transcriber import Transcriber
from ..core.models import Session
from .practice_view import PracticeView


class MainWindow(QMainWindow):
    def __init__(
        self,
        storage: SessionStorage,
        recorder: Recorder,
        transcriber: Optional[Transcriber] = None,
        analysis: Optional[AnalysisEngine] = None,
        session: Optional[Session] = None,
    ) -> None:
        super().__init__()
        self.storage = storage
        self.recorder = recorder
        self.transcriber = transcriber
        self.analysis = analysis or AnalysisEngine()
        self.session = session or self._load_or_create_session()

        self.setWindowTitle("Proach")
        self.resize(1280, 720)

        self.practice_view = PracticeView(
            session=self.session,
            storage=self.storage,
            recorder=self.recorder,
            transcriber=self.transcriber,
            analysis=self.analysis,
        )
        self.setCentralWidget(self.practice_view)

    # ------------------------------------------------------------------
    def _load_or_create_session(self) -> Session:
        session = self.storage.load_most_recent_session()
        if session:
            return session
        title, ok = QFileDialog.getSaveFileName(
            self,
            "Name your session",
            str(Path.cwd() / "sessions" / "my_pitch"),
            "Session (*.session)",
        )
        if ok and title:
            title = Path(title).stem.replace("_", " ")
        else:
            title = "My Presentation"
        return self.storage.create_session(title)
