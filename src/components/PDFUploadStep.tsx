import React, { useRef } from 'react';

interface PDFUploadStepProps {
  onFileLoaded: (file: File) => void;
}

const PDFUploadStep: React.FC<PDFUploadStepProps> = ({ onFileLoaded }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onFileLoaded(e.target.files[0]);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
      <h2 className="text-2xl font-bold mb-4 text-purple-400">Step 1: PDF 업로드</h2>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf"
        className="block w-full text-sm text-gray-500"
        onChange={handleFileChange}
      />
      <p className="text-gray-400">발표용 PDF 파일을 업로드하세요.</p>
    </div>
  );
};

export default PDFUploadStep;
