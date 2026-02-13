import React, { useState } from "react";
import { ElectronAPI } from "../types/electron";
const electronAPI: ElectronAPI | undefined = typeof window !== 'undefined' ? window.electronAPI : undefined;
import { Presentation } from "../hooks/usePresentations";
import { v4 as uuidv4 } from 'uuid';
const IconBox: React.FC<{ label: string }> = ({ label }) => (
  <span className="inline-flex items-center justify-center w-4 h-4 text-current font-bold align-middle">
    {label}
  </span>
);

interface PresentationListStepProps {
  onSelect: (presentationId: string) => void;
  presentations: Presentation[];
  add: (presentation: Presentation) => void;
  remove: (presentationId: string) => void;
}

const PresentationListStep: React.FC<PresentationListStepProps> = ({ onSelect, presentations, add, remove }) => {
  const [newName, setNewName] = useState("");
  const [newPDFPath, setNewPDFPath] = useState<string | null>(null);
  const [newPDFName, setNewPDFName] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [hasEditedName, setHasEditedName] = useState(false);

  const handleCreate = () => {
    try {
      if (!newName || !newPDFPath || !newPDFName) return;
      if (!electronAPI) {
        alert('Electron 환경에서만 PDF를 추가할 수 있습니다.');
        return;
      }

      const srcPath = newPDFPath;
      const destName = `${uuidv4()}_${newPDFName}`;
      electronAPI.copyPdfToApp(srcPath, destName)
        .then((copiedPath: string | null) => {
          console.log('PDF 복제 결과:', copiedPath);
          if (copiedPath) {
            const presentationId = uuidv4();
            add({
              id: presentationId,
              name: newName.trim(),
              createdAt: new Date().toISOString(),
              pdfName: newPDFName,
              pdfPath: copiedPath,
              pageCount: 1,
              slides: Array.from({ length: 1 }).map((_, i) => ({
                page: i + 1,
                notes: "",
                takes: [],
              })),
            });
            console.log('세션 추가 완료');
          } else {
            console.error('PDF 복제 실패: 경로가 null입니다');
          }
          setNewName("");
          setNewPDFPath(null);
          setNewPDFName("");
          setCreating(false);
        })
        .catch(err => {
          console.error('PDF 복제 중 오류:', err);
        });
    } catch (err) {
      console.error('세션 생성 중 오류:', err);
    }
  };

  const handleFileSelect = async () => {
    if (!electronAPI) {
      alert('Electron 환경에서만 PDF를 선택할 수 있습니다.');
      return;
    }

    const filePath = await electronAPI.selectPdfFile();
    if (filePath) {
      setNewPDFPath(filePath);
      const fileName = filePath.split(/[/\\]/).pop() || "";
      setNewPDFName(fileName);
      if (!hasEditedName) {
        const baseName = fileName.replace(/\.[^/.]+$/, "");
        setNewName(baseName);
      }
    }
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
                한 번의 업로드로 준비·연습·코칭까지
              </h2>
              <p className="text-lg text-slate-600 max-w-2xl leading-relaxed">
                PDF를 올리면 파일명을 기본 세션 이름으로 제안하고, 필요하면 바로 수정할 수 있습니다.
                생성된 세션은 리허설·대본 싱크·경고 탭으로 이어집니다.
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
              <label className="text-sm font-medium text-slate-700 flex items-center gap-2">
                세션 이름
                <span className="text-xs text-slate-400">PDF 파일명으로 자동 입력</span>
              </label>
              <input
                type="text"
                placeholder="예: 투자사 데모데이 리허설"
                value={newName}
                onChange={e => { setNewName(e.target.value); setHasEditedName(true); }}
                className="w-full p-4 rounded-xl bg-slate-50 text-slate-900 border-2 border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all"
              />
            </div>
            <div className="space-y-3">
              <label className="text-sm font-medium text-slate-700">PDF 업로드</label>
              <div className="relative">
                <button
                  type="button"
                  className="w-full p-4 rounded-xl bg-slate-50 text-slate-900 border-2 border-slate-200 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none transition-all font-semibold hover:bg-blue-100"
                  onClick={handleFileSelect}
                >
                  PDF 파일 선택
                </button>
                {newPDFName && (
                  <div className="absolute right-4 top-1/2 transform -translate-y-1/2 flex items-center gap-2">
                    <span className="text-green-600 text-sm">📄</span>
                    <span className="text-sm text-green-600 font-medium">{newPDFName}</span>
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
              disabled={!newName || !newPDFName || !newPDFPath}
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
