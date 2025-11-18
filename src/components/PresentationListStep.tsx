import React, { useRef, useState } from "react";
import { usePresentations, Presentation } from "../hooks/usePresentations";
import { v4 as uuidv4 } from 'uuid';

interface PresentationListStepProps {
  onSelect: (presentationId: string) => void;
}

const PresentationListStep: React.FC<PresentationListStepProps> = ({ onSelect }) => {
  const { presentations, add, remove } = usePresentations();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newName, setNewName] = useState("");
  const [newPDF, setNewPDF] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);

  const handleCreate = () => {
    if (!newName || !newPDF) return;
    const reader = new FileReader();
    reader.onload = () => {
      // PDF 데이터를 base64로 저장
      const pdfData = reader.result as string;
      add({
        id: uuidv4(),
        name: newName,
        createdAt: new Date().toISOString(),
        pdfName: newPDF.name,
        pdfData: pdfData,
        pageCount: 9, // 초기값, 나중에 PDF에서 실제 페이지 수 추정
        slides: Array.from({ length: 9 }).map((_, i) => ({
          page: i + 1,
          notes: "",
          takes: [],
        })),
      });
      setNewName("");
      setNewPDF(null);
      setCreating(false);
    };
    reader.readAsDataURL(newPDF);
  };

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6 items-center p-6">
      <h2 className="text-3xl font-bold text-purple-400">발표 세션 목록</h2>
      <ul className="w-full space-y-4">
        {presentations.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between bg-gray-800 rounded px-6 py-3 border border-gray-700"
          >
            <button
              className="text-lg font-bold text-white hover:text-purple-300 flex-1 text-left"
              onClick={() => onSelect(p.id)}
            >
              {p.name}
              <span className="text-xs text-gray-400 ml-2">({p.pdfName})</span>
            </button>
            <button
              className="ml-4 text-red-500 hover:text-red-700"
              onClick={() => remove(p.id)}
            >
              삭제
            </button>
          </li>
        ))}
      </ul>

      {!creating && (
        <button
          className="bg-purple-600 text-white px-6 py-3 mt-4 rounded-lg hover:bg-purple-700"
          onClick={() => setCreating(true)}
        >
          + 새 발표 세션 만들기
        </button>
      )}

      {creating && (
        <div className="bg-gray-800 rounded p-6 w-full flex flex-col gap-4 border border-gray-600 mt-4">
          <input
            type="text"
            placeholder="발표 이름"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="p-2 rounded bg-gray-900 text-white border"/>
          <input
            type="file"
            accept="application/pdf"
            ref={fileInputRef}
            onChange={e => {
              if (e.target.files && e.target.files.length > 0) setNewPDF(e.target.files[0]);
            }}
            className="text-gray-200"
          />
          <div className="flex gap-2">
            <button
              className="bg-purple-600 text-white px-4 py-2 rounded hover:bg-purple-700"
              disabled={!newName || !newPDF}
              onClick={handleCreate}
            >
              생성
            </button>
            <button className="ml-2 text-gray-400 hover:text-white underline" onClick={() => setCreating(false)}>
              취소
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PresentationListStep;
