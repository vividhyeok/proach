"""Flask-based web UI for Proach sessions."""

from __future__ import annotations

import os
from dataclasses import asdict
from pathlib import Path
from typing import Dict, List, Optional

from flask import Flask, abort, jsonify, request, send_from_directory

from .core.analysis import AnalysisEngine
from .core.models import Session, Slide, Take
from .core.storage import SessionStorage
from .core.transcriber import Transcriber


app = Flask(__name__, static_folder="web", static_url_path="/")

_storage = SessionStorage(Path(__file__).parent / "sessions")
_session: Session
_analysis = AnalysisEngine()
try:
    _transcriber: Optional[Transcriber] = Transcriber()
except RuntimeError:
    _transcriber = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize_session(session: Session) -> Dict[str, object]:
    return {
        "id": session.id,
        "title": session.title,
        "slides": [asdict(slide) for slide in session.slides],
        "takes_by_slide": {
            slide_id: [asdict(take) for take in takes]
            for slide_id, takes in session.takes_by_slide.items()
        },
    }


def _load_or_create_session() -> Session:
    session = _storage.load_most_recent_session()
    if session:
        return session
    return _storage.create_session("My Presentation")


def _get_slide_or_404(slide_id: int) -> Slide:
    slide = _session.get_slide(slide_id)
    if not slide:
        abort(404, description="Slide not found")
    return slide


def _get_take_or_404(slide_id: int, take_id: int) -> Take:
    takes = _session.takes_by_slide.get(slide_id, [])
    for take in takes:
        if take.id == take_id:
            return take
    abort(404, description="Take not found")


_session = _load_or_create_session()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/sessions", methods=["GET"])
def list_sessions():
    return jsonify(
        {
            "sessions": _storage.list_session_ids(),
            "active_session": _session.id,
        }
    )


@app.route("/api/sessions", methods=["POST"])
def create_session():
    data = request.get_json(force=True)
    title = (data.get("title") or "My Presentation").strip()
    slide_titles: List[str] = [
        line.strip() for line in data.get("slides", []) if line.strip()
    ]
    session = _storage.create_session(title, slide_titles)
    global _session
    _session = session
    return jsonify(_serialize_session(session))


@app.route("/api/sessions/<session_id>/open", methods=["POST"])
def open_session(session_id: str):
    sessions = _storage.list_session_ids()
    if session_id not in sessions:
        abort(404, description="Session not found")
    session = _storage.load_session(session_id)
    global _session
    _session = session
    return jsonify(_serialize_session(session))


@app.route("/api/session", methods=["GET"])
def get_session():
    return jsonify(_serialize_session(_session))


@app.route("/api/slides", methods=["POST"])
def add_slide():
    data = request.get_json(force=True)
    title = (data.get("title") or "New slide").strip()
    next_id = _session.next_slide_id()
    slide = Slide(id=next_id, title=title, notes=data.get("notes", ""))
    _session.slides.append(slide)
    _storage.save_session(_session)
    return jsonify(asdict(slide))


@app.route("/api/slides/<int:slide_id>", methods=["PUT"])
def update_slide(slide_id: int):
    slide = _get_slide_or_404(slide_id)
    data = request.get_json(force=True)
    if "title" in data:
        slide.title = data["title"].strip()
    if "notes" in data:
        slide.notes = data["notes"]
    _storage.save_session(_session)
    return jsonify(asdict(slide))


@app.route("/api/slides/<int:slide_id>", methods=["DELETE"])
def delete_slide(slide_id: int):
    _get_slide_or_404(slide_id)
    _storage.remove_slide_artifacts(_session, slide_id)
    _session.remove_slide(slide_id)
    _storage.save_session(_session)
    return jsonify({"ok": True})


@app.route("/api/slides/<int:slide_id>/takes", methods=["POST"])
def add_take(slide_id: int):
    _get_slide_or_404(slide_id)
    if "audio" not in request.files:
        abort(400, description="Missing audio file")

    audio_file = request.files["audio"]
    take_id = _session.next_take_id(slide_id)
    filename = _storage.build_take_audio_filename(slide_id, take_id)
    audio_path = _storage.session_dir(_session.id) / filename
    audio_file.save(audio_path)

    try:
        duration_sec = float(request.form.get("duration", "0"))
    except ValueError:
        duration_sec = 0.0

    if duration_sec <= 0:
        # Fallback to wave header if duration is missing.
        import wave

        with wave.open(str(audio_path), "rb") as wf:
            frames = wf.getnframes()
            rate = wf.getframerate()
            duration_sec = frames / float(rate)

    take = Take(
        id=take_id,
        slide_id=slide_id,
        audio_path=str(audio_path),
        duration_sec=duration_sec,
    )
    _session.ensure_slide_bucket(slide_id).append(take)
    _storage.save_session(_session)
    _storage.save_take_metadata(_session, take)

    return jsonify(asdict(take))


@app.route("/api/slides/<int:slide_id>/takes/<int:take_id>/transcribe", methods=["POST"])
def transcribe_take(slide_id: int, take_id: int):
    take = _get_take_or_404(slide_id, take_id)
    if not _transcriber:
        abort(503, description="Transcriber not configured")
    data = _transcriber.transcribe(Path(take.audio_path))
    take.transcript_text = data.get("text", "")
    take.transcript_meta = data
    _storage.save_session(_session)
    _storage.save_take_metadata(_session, take)
    return jsonify({"text": take.transcript_text, "meta": data})


@app.route("/api/slides/<int:slide_id>/takes/<int:take_id>/analysis", methods=["GET"])
def analyze_take(slide_id: int, take_id: int):
    take = _get_take_or_404(slide_id, take_id)
    slide = _get_slide_or_404(slide_id)
    result = _analysis.analyze(slide, take)
    return jsonify(asdict(result))


@app.route("/api/slides/<int:slide_id>/takes/<int:take_id>", methods=["GET"])
def get_take(slide_id: int, take_id: int):
    take = _get_take_or_404(slide_id, take_id)
    return jsonify(asdict(take))


# ---------------------------------------------------------------------------
# Static assets
# ---------------------------------------------------------------------------


@app.route("/web/<path:path>")
def static_proxy(path: str):
    return send_from_directory(app.static_folder, path)


if __name__ == "__main__":
    port = int(os.getenv("PORT", "5000"))
    app.run(host="0.0.0.0", port=port, debug=True)
