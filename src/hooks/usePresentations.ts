import { useEffect, useState } from "react";

export interface SlideTake {
  id: string;
  timestamp: number;
  audioUrl: string;
  transcript?: string;
  isBest?: boolean;
}

export interface SlideData {
  page: number;
  notes: string;
  takes: SlideTake[];
}

export interface Presentation {
  id: string;
  name: string;
  createdAt: string;
  pdfName: string;
  pdfData?: string; // PDF 파일 데이터 (base64)
  pageCount: number;
  slides: SlideData[];
}

const STORAGE_KEY = "proach_presentations";

function loadPresentations(): Presentation[] {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return text ? JSON.parse(text) : [];
  } catch {
    return [];
  }
}

function savePresentations(data: Presentation[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function usePresentations() {
  const [list, setList] = useState<Presentation[]>(() => loadPresentations());

  useEffect(() => {
    savePresentations(list);
  }, [list]);

  // CRUD helpers
  const add = (p: Presentation) => setList((prev) => [...prev, p]);
  const remove = (id: string) => setList((prev) => prev.filter((p) => p.id !== id));
  const update = (id: string, patch: Partial<Presentation>) =>
    setList((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  return {
    presentations: list,
    add,
    remove,
    update,
    setAll: setList,
  };
}
