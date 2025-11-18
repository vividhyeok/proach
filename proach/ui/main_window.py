"""Main window wiring session management with the practice view."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from PyQt6.QtGui import QAction
from PyQt6.QtWidgets import (
    QFileDialog,
    QInputDialog,
    QMainWindow,
    QMessageBox,
)

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
        self._build_menus()
        self._set_practice_view()

    # ------------------------------------------------------------------
    def _build_menus(self) -> None:
        menu = self.menuBar().addMenu("&File")

        new_action = QAction("New session", self)
        new_action.triggered.connect(self._create_new_session)
        menu.addAction(new_action)

        open_action = QAction("Open session...", self)
        open_action.triggered.connect(self._open_session)
        menu.addAction(open_action)

        menu.addSeparator()

        exit_action = QAction("Exit", self)
        exit_action.triggered.connect(self.close)
        menu.addAction(exit_action)

    def _set_practice_view(self) -> None:
        if hasattr(self, "practice_view"):
            self.practice_view.deleteLater()
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
        title = "My Presentation"
        slide_titles = ["Intro", "Problem", "Solution", "Close"]
        return self.storage.create_session(title, slide_titles)

    def _create_new_session(self) -> None:
        title, ok = QInputDialog.getText(
            self,
            "New session",
            "Session title",
            text="My Presentation",
        )
        if not ok or not title.strip():
            return

        slides_text, ok = QInputDialog.getMultiLineText(
            self,
            "Slides",
            "Enter one slide title per line",
            "Intro\nProblem\nSolution\nClose",
        )
        if not ok:
            return

        slide_titles = [line.strip() for line in slides_text.splitlines() if line.strip()]
        if not slide_titles:
            QMessageBox.warning(self, "Missing slides", "Add at least one slide title.")
            return

        self.session = self.storage.create_session(title.strip(), slide_titles)
        self._set_practice_view()

    def _open_session(self) -> None:
        path_str, _ = QFileDialog.getOpenFileName(
            self,
            "Open session.json",
            str(self.storage.sessions_root),
            "Session file (session.json)",
        )
        if not path_str:
            return
        path = Path(path_str)
        if path.name != "session.json" or not path.exists():
            QMessageBox.warning(self, "Invalid file", "Select a valid session.json file")
            return
        session_id = path.parent.name
        self.session = self.storage.load_session(session_id)
        self._set_practice_view()
