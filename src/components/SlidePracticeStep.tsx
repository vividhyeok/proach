import React, { useState, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { usePresentations, Presentation } from '../hooks/usePresentations';
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// PDF.js 워커 설정 - 최신 버전 사용
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/5.4.394/pdf.worker.min.js`;

interface SlidePracticeStepProps {
  presentation: Presentation;
  onBack: () => void;
}

const SlidePracticeStep: React.FC<SlidePracticeStepProps> = ({ presentation, onBack }) => {
  const { update } = usePresentations();
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState<number>(presentation.pageCount);
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [pdfError, setPdfError] = useState<string | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks = useRef<Blob[]>([]);

  const currentSlide = presentation.slides[currentPage - 1] || { 
    page: currentPage, 
    notes: '', 
    takes: [] 
  };

  useEffect(() => {
    if (!presentation.pdfData) {
      setPdfError('PDF 데이터가 없습니다.');
    }
  }, [presentation.pdfData]);

  const handleLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPdfError(null);
    update(presentation.id, { pageCount: numPages });
  };

  const handleLoadError = (error: Error) => {
    console.error('PDF 로드 오류:', error);
    setPdfError('PDF 파일을 로드할 수 없습니다. 파일 형식을 확인해주세요.');
  };

  return (
    <div className="flex flex-col min-h-[80vh] gap-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-purple-400">
          {presentation.name} - 슬라이드 연습
        </h2>
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-white underline"
        >
          발표 목록으로
        </button>
      </div>

      <div className="flex gap-6 flex-1">
        {/* PDF 뷰어 */}
        <div className="flex-1 bg-gray-800 rounded-lg p-4">
          <div className="bg-white rounded p-2 min-h-[500px] flex items-center justify-center">
            {pdfError ? (
              <div className="text-red-500 text-center">
                <p>{pdfError}</p>
                <p className="text-sm text-gray-600 mt-2">PDF 파일을 다시 업로드해주세요.</p>
              </div>
            ) : (
              <Document
                file={presentation.pdfData}
                onLoadSuccess={handleLoadSuccess}
                onLoadError={handleLoadError}
                loading={<div className="text-gray-600">PDF 로딩 중...</div>}
              >
                <Page 
                  pageNumber={currentPage} 
                  width={500}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                />
              </Document>
            )}
          </div>
        </div>

        {/* 녹음 및 노트 패널 */}
        <div className="w-80 bg-gray-800 rounded-lg p-4">
          <h3 className="text-lg font-semibold mb-4 text-purple-300">
            슬라이드 {currentPage} - 연습
          </h3>

          {/* 녹음 컨트롤 및 노트 입력 코드... */}
        </div>
      </div>
    </div>
  );
};

export default SlidePracticeStep;
