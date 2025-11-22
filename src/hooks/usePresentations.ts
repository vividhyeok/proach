import { useEffect, useState } from "react";

export interface SlideTake {
  id: string;
  timestamp: number;
  audioUrl: string;
  transcript?: string;
  isBest?: boolean;
  mode?: 'draft' | 'final';
  modelId?: string;
  takeNumber?: number;
  feedback?: string;
}

export interface SlideData {
  page: number;
  notes: string;
  takes: SlideTake[];
  curatedScript?: string;
  curatedScriptMeta?: {
    generatedAt: number;
    sourceTakeIds: string[];
    keyPoints?: string[];
  };
  liveSyncPreview?: {
    alignmentSummary: string;
    missingPoints?: string;
    nextLines?: string[];
    generatedAt: number;
  };
}

export interface Presentation {
  id: string;
  name: string;
  createdAt: string;
  pdfName: string;
  pdfData?: string; // PDF 파일 데이터 (base64) - 용량 이슈로 저장하지 않음
  pageCount: number;
  slides: SlideData[];
  fullScript?: string; // 전체 프레젠테이션 대본
  fullScriptGeneratedAt?: number; // 전체 대본 생성 시간
}

const STORAGE_KEY = "proach_presentations";
const PDF_STORAGE_KEY = "proach_pdf_data"; // PDF 데이터용 별도 키

function loadPresentations(): Presentation[] {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    const presentations = text ? JSON.parse(text) : [];

    // 기존 데이터에서 PDF 데이터 제거 및 마이그레이션
    let needsMigration = false;
    const migratedPresentations = presentations.map((p: any) => {
      if (p.pdfData) {
        // PDF 데이터가 있으면 sessionStorage로 이동
        savePdfData(p.id, p.pdfData);
        needsMigration = true;
        return { ...p, pdfData: undefined };
      }
      return p;
    });

    // 마이그레이션된 데이터 저장
    if (needsMigration) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migratedPresentations));
      console.log('✅ Migrated PDF data from localStorage to sessionStorage');
    }

    return migratedPresentations;
  } catch (error) {
    console.error('Error loading presentations:', error);
    // 오류 발생 시 localStorage 정리
    try {
      localStorage.removeItem(STORAGE_KEY);
      console.log('🧹 Cleared corrupted localStorage data');
    } catch {
      // 무시
    }
    return [];
  }
}

function savePresentations(data: Presentation[]) {
  // PDF 데이터 제외하고 저장
  const dataWithoutPdf = data.map(p => ({ ...p, pdfData: undefined }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(dataWithoutPdf));
}

// PDF 데이터를 sessionStorage에 저장 (더 큰 용량 지원)
function savePdfData(presentationId: string, pdfData: string) {
  try {
    sessionStorage.setItem(`${PDF_STORAGE_KEY}_${presentationId}`, pdfData);
  } catch (error) {
    console.warn('Failed to save PDF data to sessionStorage:', error);
  }
}

function loadPdfData(presentationId: string): string | undefined {
  try {
    return sessionStorage.getItem(`${PDF_STORAGE_KEY}_${presentationId}`) || undefined;
  } catch {
    return undefined;
  }
}

export function usePresentations() {
  const [list, setList] = useState<Presentation[]>(() => {
    const presentations = loadPresentations();
    // 각 프레젠테이션에 PDF 데이터 로드
    return presentations.map(p => ({
      ...p,
      pdfData: loadPdfData(p.id)
    }));
  });

  useEffect(() => {
    savePresentations(list);
    // PDF 데이터 저장
    list.forEach(p => {
      if (p.pdfData) {
        savePdfData(p.id, p.pdfData);
      }
    });
  }, [list]);

  // CRUD helpers
  const add = (p: Presentation) => setList((prev) => [...prev, p]);
  const remove = (id: string) => {
    // PDF 데이터도 삭제
    try {
      sessionStorage.removeItem(`${PDF_STORAGE_KEY}_${id}`);
    } catch (error) {
      console.warn('Failed to remove PDF data from sessionStorage:', error);
    }
    setList((prev) => prev.filter((p) => p.id !== id));
  };
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
