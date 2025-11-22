import React, { useRef, useState } from "react";
import { usePresentations } from "../hooks/usePresentations";
import { v4 as uuidv4 } from 'uuid';
const IconBox: React.FC<{ label: string }> = ({ label }) => (
  <span className="inline-flex items-center justify-center w-4 h-4 text-current font-bold align-middle">
    {label}
  </span>
);

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
      const presentationId = uuidv4();
      add({
        id: presentationId,
        name: newName,
        createdAt: new Date().toISOString(),
        pdfName: newPDF.name,
        pdfData: pdfData, // 임시로 포함 (usePresentations에서 sessionStorage로 이동)
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
    <div className="p-8 lg:p-12 space-y-8">
      {/* Header Section */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-blue-600 font-medium">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />
            Step 1 · 세션 관리
          </div>
          <h2 className="text-3xl lg:text-4xl font-bold text-slate-900">
            발표 세션을 체계적으로 관리하세요
          </h2>
          <p className="text-lg text-slate-600 max-w-2xl leading-relaxed">
            PDF 자료를 업로드하고 세션을 생성하여 효율적인 발표 연습을 시작해보세요.
          </p>
        </div>
        {!creating && (
          <button
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-4 rounded-2xl hover:bg-blue-700 transition-all duration-200 font-semibold shadow-lg hover:shadow-xl"
            onClick={() => setCreating(true)}
          >
            <IconBox label="＋" />
            새 세션 만들기
          </button>
        )}
      </div>

      {/* Presentations Grid */}
      <div className="space-y-6">
          {presentations.length === 0 && !creating && (
            <div className="text-center border-2 border-dashed border-slate-200 rounded-3xl p-16 space-y-4">
              <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto">
                <span className="text-blue-600 text-3xl">📄</span>
              </div>
            <div className="space-y-2">
              <p className="text-xl font-semibold text-slate-900">아직 생성된 세션이 없습니다</p>
              <p className="text-slate-600">PDF 자료와 함께 첫 번째 세션을 만들어보세요.</p>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-2 xl:grid-cols-3 gap-6">
          {presentations.map((p) => (
            <div
              key={p.id}
              className="bg-white border-2 border-slate-100 rounded-2xl p-6 space-y-4 hover:border-blue-200 hover:shadow-lg transition-all duration-200 group"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2 flex-1">
                  <button
                    className="text-lg font-semibold text-slate-900 hover:text-blue-600 text-left transition-colors line-clamp-2"
                    onClick={() => onSelect(p.id)}
                  >
                    {p.name}
                  </button>
                  <div className="space-y-1">
                    <p className="text-sm text-slate-500">
                      {new Date(p.createdAt).toLocaleDateString('ko-KR')}
                    </p>
                    <p className="text-xs text-slate-400 truncate">{p.pdfName}</p>
                  </div>
                </div>
                <button
                  className="text-slate-400 hover:text-red-500 transition-colors p-1 rounded-lg hover:bg-red-50"
                  onClick={() => remove(p.id)}
                >
                  <IconBox label="✕" />
                </button>
              </div>
              
              <div className="flex items-center gap-2">
                <span className="px-3 py-1.5 rounded-full bg-slate-50 text-slate-700 text-xs font-medium border border-slate-200">
                  슬라이드 {p.pageCount}p
                </span>
                <span className="px-3 py-1.5 rounded-full bg-slate-50 text-slate-700 text-xs font-medium border border-slate-200">
                  녹음 {p.slides.reduce((sum, s) => sum + s.takes.length, 0)}개
                </span>
              </div>
              
              <button
                className="w-full bg-slate-900 text-white rounded-xl py-3 text-sm font-semibold hover:bg-slate-800 transition-colors group-hover:bg-blue-600"
                onClick={() => onSelect(p.id)}
              >
                이 세션에서 연습하기
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Create Session Modal */}
      {creating && (
        <div className="bg-white border-2 border-slate-200 rounded-3xl p-8 space-y-6 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <h3 className="text-2xl font-bold text-slate-900">새 발표 세션</h3>
              <p className="text-slate-600">발표 연습을 위한 세션 정보를 입력해주세요.</p>
            </div>
            <button
              className="text-slate-400 hover:text-slate-600 transition-colors p-2 rounded-lg hover:bg-slate-100"
              onClick={() => setCreating(false)}
            >
              <IconBox label="✕" />
            </button>
          </div>
          
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="space-y-3">
              <label className="text-sm font-medium text-slate-700">세션 이름</label>
              <input
                type="text"
                placeholder="예: 투자사 데모데이 리허설"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                className="w-full p-4 rounded-xl bg-slate-50 text-slate-900 border-2 border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
              />
            </div>
            <div className="space-y-3">
              <label className="text-sm font-medium text-slate-700">PDF 업로드</label>
              <div className="relative">
                <input
                  type="file"
                  accept="application/pdf"
                  ref={fileInputRef}
                  onChange={e => {
                    if (e.target.files && e.target.files.length > 0) setNewPDF(e.target.files[0]);
                  }}
                  className="w-full p-4 rounded-xl bg-slate-50 text-slate-900 border-2 border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {newPDF && (
                  <div className="absolute right-4 top-1/2 transform -translate-y-1/2 flex items-center gap-2">
                    <span className="text-green-600 text-sm">📄</span>
                    <span className="text-sm text-green-600 font-medium">{newPDF.name}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex gap-3 justify-end pt-4">
            <button
              className="px-6 py-3 text-slate-600 hover:text-slate-800 font-medium transition-colors"
              onClick={() => setCreating(false)}
            >
              취소
            </button>
            <button
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all font-semibold"
              disabled={!newName || !newPDF}
              onClick={handleCreate}
            >
              <IconBox label="⇧" />
              세션 생성
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PresentationListStep;