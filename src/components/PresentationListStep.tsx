import React, { useRef, useState } from "react";
import { usePresentations } from "../hooks/usePresentations";
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
      const pdfData = reader.result as string;
      add({
        id: uuidv4(),
        name: newName,
        createdAt: new Date().toISOString(),
        pdfName: newPDF.name,
        pdfData: pdfData,
        pageCount: 9,
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
    <div className="p-10 md:p-12 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <p className="text-sm text-slate-400">Step 1 · 세션 관리</p>
          <h2 className="text-3xl font-bold text-white mt-1">발표 세션을 모아 관리하세요</h2>
          <p className="text-slate-400 mt-2">PDF를 올려 세션을 만들고, 필요한 슬라이드를 빠르게 연습 공간으로 보냅니다.</p>
        </div>
        {!creating && (
          <button
            className="bg-purple-500 text-white px-4 py-3 rounded-xl hover:bg-purple-600 transition font-semibold"
            onClick={() => setCreating(true)}
          >
            + 새 세션 만들기
          </button>
        )}
      </div>

      <div className="grid gap-4">
        {presentations.length === 0 && !creating && (
          <div className="text-center border border-dashed border-slate-700 rounded-2xl p-10 text-slate-400">
            <p className="text-lg font-semibold text-white">아직 생성된 세션이 없습니다</p>
            <p className="mt-2">PDF 자료와 함께 세션을 만들고 연습을 시작하세요.</p>
          </div>
        )}

        <ul className="grid md:grid-cols-2 gap-4">
          {presentations.map((p) => (
            <li
              key={p.id}
              className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col gap-3 hover:border-purple-500/50 transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <button
                    className="text-lg font-semibold text-white hover:text-purple-200 text-left"
                    onClick={() => onSelect(p.id)}
                  >
                    {p.name}
                  </button>
                  <p className="text-xs text-slate-400">{new Date(p.createdAt).toLocaleDateString()} · {p.pdfName}</p>
                </div>
                <button
                  className="text-sm text-slate-400 hover:text-red-400"
                  onClick={() => remove(p.id)}
                >
                  삭제
                </button>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span className="px-2 py-1 rounded-full bg-slate-800 border border-slate-700">슬라이드 {p.pageCount}p</span>
                <span className="px-2 py-1 rounded-full bg-slate-800 border border-slate-700">녹음 {p.slides.reduce((sum, s) => sum + s.takes.length, 0)}개</span>
              </div>
              <button
                className="w-full bg-slate-800 hover:bg-purple-600/80 text-white rounded-xl py-2 text-sm font-semibold"
                onClick={() => onSelect(p.id)}
              >
                이 세션에서 연습하기
              </button>
            </li>
          ))}
        </ul>
      </div>

      {creating && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-semibold text-white">새 발표 세션</h3>
            <button className="text-slate-400 hover:text-white" onClick={() => setCreating(false)}>
              닫기
            </button>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm text-slate-300">세션 이름</label>
              <input
                type="text"
                placeholder="예: 투자사 데모데이 리허설"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                className="p-3 rounded-xl bg-slate-950 text-white border border-slate-800 focus:border-purple-500 outline-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-slate-300">PDF 업로드</label>
              <div className="relative">
                <input
                  type="file"
                  accept="application/pdf"
                  ref={fileInputRef}
                  onChange={e => {
                    if (e.target.files && e.target.files.length > 0) setNewPDF(e.target.files[0]);
                  }}
                  className="w-full p-3 rounded-xl bg-slate-950 text-slate-200 border border-slate-800"
                />
                {newPDF && <span className="absolute right-3 top-3 text-xs text-purple-300">{newPDF.name}</span>}
              </div>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              className="px-4 py-2 text-sm text-slate-300 hover:text-white"
              onClick={() => setCreating(false)}
            >
              취소
            </button>
            <button
              className="bg-purple-500 text-white px-4 py-2 rounded-xl hover:bg-purple-600 disabled:opacity-40"
              disabled={!newName || !newPDF}
              onClick={handleCreate}
            >
              세션 생성
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PresentationListStep;
