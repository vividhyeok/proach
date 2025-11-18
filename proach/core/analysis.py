"""Rule-based analysis placeholder that can later be LLM-driven."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List

from .models import Slide, Take


@dataclass
class AnalysisResult:
    summary: str
    missing_keywords: List[str]
    timing_label: str


class AnalysisEngine:
    """Quick heuristics for MVP feedback."""

    def analyze(self, slide: Slide, take: Take) -> AnalysisResult:
        transcript = (take.transcript_text or "").lower()
        keywords = [kw.strip().lower() for kw in slide.notes.split("\n") if kw.strip()]
        missing_keywords = [kw for kw in keywords if kw not in transcript]

        timing_label = "good"
        if take.duration_sec > 90:
            timing_label = "long"
        elif take.duration_sec < 20:
            timing_label = "short"

        summary_lines = [
            f"Slide: {slide.title}",
            f"Duration: {take.duration_sec:.1f}s ({timing_label})",
        ]
        if missing_keywords:
            summary_lines.append(
                "Missing keywords: " + ", ".join(missing_keywords)
            )
        else:
            summary_lines.append("All noted keywords covered.")

        return AnalysisResult(
            summary="\n".join(summary_lines),
            missing_keywords=missing_keywords,
            timing_label=timing_label,
        )

    def analyze_range(self, items: List[Dict[str, object]]) -> AnalysisResult:
        summaries = []
        missing = []
        timings = []
        for payload in items:
            result = self.analyze(payload["slide"], payload["take"])
            summaries.append(result.summary)
            missing.extend(result.missing_keywords)
            timings.append(result.timing_label)
        timing_label = self._aggregate_timing(timings)
        return AnalysisResult(
            summary="\n\n".join(summaries),
            missing_keywords=missing,
            timing_label=timing_label,
        )

    def _aggregate_timing(self, labels: List[str]) -> str:
        if not labels:
            return "unknown"
        if "long" in labels:
            return "long"
        if "short" in labels:
            return "short"
        return "good"
