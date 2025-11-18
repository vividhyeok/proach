"""Helpers for persisting sessions, slides, and takes."""

from __future__ import annotations

import json
import re
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Optional

from .models import Session, Slide, Take


class SessionStorage:
    """File-system backed storage rooted under the sessions/ directory."""

    def __init__(self, sessions_root: Path):
        self.sessions_root = Path(sessions_root)
        self.sessions_root.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Session-level helpers
    # ------------------------------------------------------------------
    def list_session_ids(self) -> List[str]:
        return sorted([p.name for p in self.sessions_root.iterdir() if p.is_dir()])

    def session_dir(self, session_id: str) -> Path:
        path = self.sessions_root / session_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def session_file(self, session_id: str) -> Path:
        return self.session_dir(session_id) / "session.json"

    def save_session(self, session: Session) -> Path:
        payload = session.to_dict()
        path = self.session_file(session.id)
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        return path

    def load_session(self, session_id: str) -> Session:
        payload = json.loads(self.session_file(session_id).read_text(encoding="utf-8"))
        return Session.from_dict(payload)

    def load_most_recent_session(self) -> Optional[Session]:
        session_dirs = [p for p in self.sessions_root.iterdir() if p.is_dir()]
        if not session_dirs:
            return None
        latest_dir = max(session_dirs, key=lambda p: p.stat().st_mtime)
        return self.load_session(latest_dir.name)

    def create_session(self, title: str, slide_titles: Optional[Iterable[str]] = None) -> Session:
        session_id = self._build_session_id(title)
        slides = self._build_slides(slide_titles)
        session = Session(id=session_id, title=title, slides=slides)
        self.save_session(session)
        return session

    # ------------------------------------------------------------------
    # Take helpers
    # ------------------------------------------------------------------
    def build_take_audio_filename(self, slide_id: int, take_id: int) -> str:
        return f"slide_{slide_id:02d}_take_{take_id:02d}.wav"

    def build_take_metadata_path(self, session: Session, take: Take) -> Path:
        return self.session_dir(session.id) / f"{Path(take.audio_path).stem}.json"

    def save_take_metadata(self, session: Session, take: Take) -> Path:
        path = self.build_take_metadata_path(session, take)
        path.write_text(json.dumps(asdict(take), indent=2), encoding="utf-8")
        return path

    def remove_slide_artifacts(self, session: Session, slide_id: int) -> None:
        """Delete audio/metadata files related to a slide.

        The caller is responsible for updating the in-memory ``session``
        structure (removing the slide and its takes) before saving.
        """

        takes = session.takes_by_slide.get(slide_id, [])
        for take in takes:
            audio_path = Path(take.audio_path)
            metadata_path = self.build_take_metadata_path(session, take)
            for path in (audio_path, metadata_path):
                try:
                    path.unlink()
                except FileNotFoundError:
                    continue
        session.takes_by_slide.pop(slide_id, None)

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _slugify(self, text: str) -> str:
        text = text.strip().lower()
        text = re.sub(r"[^a-z0-9]+", "_", text)
        text = re.sub(r"_+", "_", text).strip("_")
        return text or "session"

    def _build_session_id(self, title: str) -> str:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return f"{timestamp}_{self._slugify(title)}"

    def _build_slides(self, titles: Optional[Iterable[str]]) -> List[Slide]:
        if not titles:
            titles = ["Intro", "Problem", "Solution", "Close"]
        slides: List[Slide] = []
        for idx, raw_title in enumerate(titles, start=1):
            slides.append(Slide(id=idx, title=raw_title.strip()))
        return slides
