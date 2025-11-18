"""Practice view widgets that hook into recorder/transcriber flows."""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from PyQt6.QtCore import Qt, QThread, pyqtSignal
from PyQt6.QtWidgets import (
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QListWidget,
    QListWidgetItem,
    QPushButton,
    QTextEdit,
    QLineEdit,
    QMessageBox,
)

from ..core.analysis import AnalysisEngine
from ..core.models import Session, Slide, Take
from ..core.recorder import Recorder
from ..core.storage import SessionStorage
from ..core.transcriber import Transcriber


class TranscriptionWorker(QThread):
    finished = pyqtSignal(dict)
    failed = pyqtSignal(str)

    def __init__(self, transcriber: Transcriber, audio_path: Path):
        super().__init__()
        self.transcriber = transcriber
        self.audio_path = audio_path

    def run(self):
        try:
            result = self.transcriber.transcribe(self.audio_path)
            self.finished.emit(result)
        except Exception as exc:  # noqa: BLE001 - surface to UI
            self.failed.emit(str(exc))


class PracticeView(QWidget):
    """Central widget enabling slide management, recording, and analysis."""

    def __init__(
        self,
        session: Session,
        storage: SessionStorage,
        recorder: Recorder,
        transcriber: Optional[Transcriber] = None,
        analysis: Optional[AnalysisEngine] = None,
        parent: Optional[QWidget] = None,
    ) -> None:
        super().__init__(parent)
        self.session = session
        self.storage = storage
        self.recorder = recorder
        self.transcriber = transcriber
        self.analysis = analysis or AnalysisEngine()
        self.transcription_thread: Optional[TranscriptionWorker] = None

        self.current_slide: Optional[Slide] = session.slides[0] if session.slides else None

        self._build_ui()
        self._refresh_slides()
        self._refresh_takes()

    # ------------------------------------------------------------------
    def _build_ui(self) -> None:
        layout = QHBoxLayout(self)

        # Left pane: slides
        left = QVBoxLayout()
        left.addWidget(QLabel("Slides"))
        self.slide_list = QListWidget()
        self.slide_list.currentItemChanged.connect(self._on_slide_selected)
        left.addWidget(self.slide_list, 1)
        self.slide_title = QLineEdit()
        self.slide_title.setPlaceholderText("Slide title")
        self.slide_title.editingFinished.connect(self._on_slide_title_edited)
        left.addWidget(self.slide_title)
        self.slide_notes = QTextEdit()
        self.slide_notes.setPlaceholderText("Notes / keywords (one per line)")
        self.slide_notes.textChanged.connect(self._on_notes_changed)
        left.addWidget(self.slide_notes, 2)
        layout.addLayout(left, 2)

        # Center pane: recording controls
        center = QVBoxLayout()
        center.addWidget(QLabel("Recording"))
        self.record_button = QPushButton("Start recording")
        self.record_button.clicked.connect(self._on_record_clicked)
        center.addWidget(self.record_button)
        self.stop_button = QPushButton("Stop")
        self.stop_button.setEnabled(False)
        self.stop_button.clicked.connect(self._on_stop_clicked)
        center.addWidget(self.stop_button)
        self.status_label = QLabel("Idle")
        center.addWidget(self.status_label)
        layout.addLayout(center, 1)

        # Right pane: takes and transcripts
        right = QVBoxLayout()
        right.addWidget(QLabel("Takes"))
        self.take_list = QListWidget()
        self.take_list.currentItemChanged.connect(self._on_take_selected)
        right.addWidget(self.take_list, 1)

        self.transcript_view = QTextEdit()
        self.transcript_view.setReadOnly(True)
        right.addWidget(self.transcript_view, 1)

        self.analyze_button = QPushButton("Transcribe & analyze take")
        self.analyze_button.clicked.connect(self._on_analyze_clicked)
        right.addWidget(self.analyze_button)

        self.analysis_view = QTextEdit()
        self.analysis_view.setReadOnly(True)
        right.addWidget(self.analysis_view, 1)

        layout.addLayout(right, 2)

    # ------------------------------------------------------------------
    def _refresh_slides(self) -> None:
        self.slide_list.clear()
        for slide in self.session.slides:
            item = QListWidgetItem(f"{slide.id:02d} - {slide.title}")
            item.setData(Qt.ItemDataRole.UserRole, slide)
            self.slide_list.addItem(item)
        if self.session.slides:
            self.slide_list.setCurrentRow(0)

    def _refresh_takes(self) -> None:
        self.take_list.clear()
        if not self.current_slide:
            return
        takes = self.session.takes_by_slide.get(self.current_slide.id, [])
        for take in takes:
            item = QListWidgetItem(f"Take {take.id} ({take.duration_sec:.1f}s)")
            item.setData(Qt.ItemDataRole.UserRole, take)
            self.take_list.addItem(item)

    # ------------------------------------------------------------------
    def _on_slide_selected(self, current: QListWidgetItem, _previous: QListWidgetItem) -> None:
        if not current:
            self.current_slide = None
            return
        slide = current.data(Qt.ItemDataRole.UserRole)
        self.current_slide = slide
        self.slide_title.setText(slide.title)
        self.slide_notes.setPlainText(slide.notes)
        self._refresh_takes()

    def _on_slide_title_edited(self) -> None:
        if not self.current_slide:
            return
        self.current_slide.title = self.slide_title.text().strip()
        self.storage.save_session(self.session)
        self._refresh_slides()

    def _on_notes_changed(self) -> None:
        if not self.current_slide:
            return
        self.current_slide.notes = self.slide_notes.toPlainText()
        self.storage.save_session(self.session)

    # ------------------------------------------------------------------
    def _on_record_clicked(self) -> None:
        if not self.current_slide:
            QMessageBox.warning(self, "No slide", "Select a slide first.")
            return
        slide_id = self.current_slide.id
        take_id = self.session.next_take_id(slide_id)
        filename = self.storage.build_take_audio_filename(slide_id, take_id)
        audio_path = self.storage.session_dir(self.session.id) / filename
        try:
            self.recorder.start(audio_path)
        except Exception as exc:  # noqa: BLE001 - show to user
            QMessageBox.critical(self, "Recording error", str(exc))
            return
        self.status_label.setText(f"Recording take {take_id}...")
        self.record_button.setEnabled(False)
        self.stop_button.setEnabled(True)

    def _on_stop_clicked(self) -> None:
        try:
            duration = self.recorder.stop()
        except Exception as exc:  # noqa: BLE001 - show to user
            QMessageBox.critical(self, "Recording error", str(exc))
            return
        self.record_button.setEnabled(True)
        self.stop_button.setEnabled(False)
        self.status_label.setText("Idle")

        if not self.current_slide:
            return
        slide_id = self.current_slide.id
        take_id = self.session.next_take_id(slide_id) - 1
        filename = self.storage.build_take_audio_filename(slide_id, take_id)
        audio_path = self.storage.session_dir(self.session.id) / filename
        take = Take(
            id=take_id,
            slide_id=slide_id,
            audio_path=str(audio_path),
            duration_sec=duration,
        )
        self.session.ensure_slide_bucket(slide_id).append(take)
        self.storage.save_session(self.session)
        self.storage.save_take_metadata(self.session, take)
        self._refresh_takes()

    # ------------------------------------------------------------------
    def _on_take_selected(self, current: QListWidgetItem, _previous: QListWidgetItem) -> None:
        take: Optional[Take] = current.data(Qt.ItemDataRole.UserRole) if current else None
        if not take:
            self.transcript_view.clear()
            self.analysis_view.clear()
            return
        self.transcript_view.setPlainText(take.transcript_text)
        self.analysis_view.clear()

    def _on_analyze_clicked(self) -> None:
        take = self._current_take()
        if not take:
            QMessageBox.warning(self, "No take", "Select a take to transcribe")
            return
        if not self.transcriber:
            QMessageBox.warning(self, "Transcriber missing", "Configure API key first.")
            return
        if take.transcript_text:
            self._run_analysis(take)
            return

        self.analyze_button.setEnabled(False)
        self.status_label.setText("Transcribing...")
        self.transcription_thread = TranscriptionWorker(self.transcriber, Path(take.audio_path))
        self.transcription_thread.finished.connect(lambda data: self._on_transcription_done(take, data))
        self.transcription_thread.failed.connect(self._on_transcription_failed)
        self.transcription_thread.start()

    def _on_transcription_done(self, take: Take, data: dict) -> None:
        self.analyze_button.setEnabled(True)
        self.status_label.setText("Idle")
        text = data.get("text", "")
        take.transcript_text = text
        take.transcript_meta = data
        self.storage.save_session(self.session)
        self.storage.save_take_metadata(self.session, take)
        self.transcript_view.setPlainText(text)
        self._run_analysis(take)

    def _on_transcription_failed(self, message: str) -> None:
        self.analyze_button.setEnabled(True)
        self.status_label.setText("Idle")
        QMessageBox.critical(self, "Transcription error", message)

    def _run_analysis(self, take: Take) -> None:
        slide = self.session.get_slide(take.slide_id)
        if not slide:
            QMessageBox.warning(self, "Missing slide", "Slide not found")
            return
        result = self.analysis.analyze(slide, take)
        self.analysis_view.setPlainText(result.summary)

    def _current_take(self) -> Optional[Take]:
        item = self.take_list.currentItem()
        if not item:
            return None
        return item.data(Qt.ItemDataRole.UserRole)
