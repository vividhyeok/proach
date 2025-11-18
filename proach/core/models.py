"""Domain models used across Proach."""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Dict, List, Optional


@dataclass
class Slide:
    """A single slide inside a practice session."""

    id: int
    title: str
    notes: str = ""


@dataclass
class Take:
    """A recording attempt tied to a specific slide."""

    id: int
    slide_id: int
    audio_path: str
    duration_sec: float
    transcript_text: str = ""
    transcript_meta: Dict[str, object] = field(default_factory=dict)
    created_at: str = field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))


@dataclass
class Session:
    """A full practice session grouping slides and takes."""

    id: str
    title: str
    slides: List[Slide] = field(default_factory=list)
    takes_by_slide: Dict[int, List[Take]] = field(default_factory=dict)

    def get_slide(self, slide_id: int) -> Optional[Slide]:
        return next((slide for slide in self.slides if slide.id == slide_id), None)

    def ensure_slide_bucket(self, slide_id: int) -> List[Take]:
        if slide_id not in self.takes_by_slide:
            self.takes_by_slide[slide_id] = []
        return self.takes_by_slide[slide_id]

    def iter_takes(self, slide_id: int) -> List[Take]:
        return list(self.takes_by_slide.get(slide_id, []))

    def next_slide_id(self) -> int:
        if not self.slides:
            return 1
        return max(slide.id for slide in self.slides) + 1

    def next_take_id(self, slide_id: int) -> int:
        takes = self.takes_by_slide.get(slide_id, [])
        if not takes:
            return 1
        return max(take.id for take in takes) + 1

    def remove_slide(self, slide_id: int) -> None:
        self.slides = [slide for slide in self.slides if slide.id != slide_id]
        self.takes_by_slide.pop(slide_id, None)

    def to_dict(self) -> Dict[str, object]:
        payload = asdict(self)
        # JSON does not like int keys, so stringify them.
        payload["takes_by_slide"] = {
            str(slide_id): [asdict(take) for take in takes]
            for slide_id, takes in self.takes_by_slide.items()
        }
        return payload

    @classmethod
    def from_dict(cls, payload: Dict[str, object]) -> "Session":
        slides = [Slide(**data) for data in payload.get("slides", [])]
        takes_by_slide: Dict[int, List[Take]] = {}
        raw_takes = payload.get("takes_by_slide", {})
        for slide_id_str, take_list in raw_takes.items():
            slide_id = int(slide_id_str)
            takes_by_slide[slide_id] = [Take(**take_data) for take_data in take_list]
        return cls(
            id=payload["id"],
            title=payload.get("title", payload["id"]),
            slides=slides,
            takes_by_slide=takes_by_slide,
        )
