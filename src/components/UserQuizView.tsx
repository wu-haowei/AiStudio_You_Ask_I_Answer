import React, { useState, useMemo } from 'react';
import {
  BrainCircuit,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Trophy,
  HelpCircle,
  ArrowRight,
  Sparkles,
  Award,
} from 'lucide-react';
import { FAQItem } from '../types';

interface UserQuizViewProps {
  faqs: FAQItem[];
  showToast: (title: string, description?: string, type?: 'success' | 'info') => void;
}

export const UserQuizView: React.FC<UserQuizViewProps> = ({ faqs }) => {
  // Filter FAQs that have options and a valid correct index
  const quizQuestions = useMemo(() => {
    return faqs.filter(
      (f) => !f.isHidden && f.options && f.options.length > 0 && typeof f.correctOptionIndex === 'number'
    );
  }, [faqs]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [answeredCount, setAnsweredCount] = useState(0);
  const [isQuizCompleted, setIsQuizCompleted] = useState(false);

  const currentFaq = quizQuestions[currentIndex];

  const handleSelectOption = (index: number) => {
    if (selectedOption !== null || !currentFaq) return;
    setSelectedOption(index);
    setAnsweredCount((prev) => prev + 1);

    if (index === currentFaq.correctOptionIndex) {
      setScore((prev) => prev + 1);
    }
  };

  const handleNextQuestion = () => {
    if (currentIndex < quizQuestions.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setSelectedOption(null);
    } else {
      setIsQuizCompleted(true);
    }
  };

  const handleRestartQuiz = () => {
    setCurrentIndex(0);
    setSelectedOption(null);
    setScore(0);
    setAnsweredCount(0);
    setIsQuizCompleted(false);
  };

  if (quizQuestions.length === 0) {
    return (
      <div className="text-center py-16 px-4 bg-white rounded-3xl border border-[#E8DFD3] space-y-4">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-[#F4ECE1] flex items-center justify-center text-[#8C6D53]">
          <BrainCircuit className="w-8 h-8" />
        </div>
        <h3 className="text-lg font-bold text-[#3A2E2B]">暫無可測驗的題庫項目</h3>
        <p className="text-sm text-[#7A6C65] max-w-md mx-auto">
          後台管理員可於「Q&A 內容管理」為常見問題新增互動測驗選項，即可開啓測驗挑戰！
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      {/* Quiz Header Banner */}
      <div className="rounded-3xl bg-gradient-to-br from-[#8C6D53] to-[#73573F] text-white p-6 sm:p-8 shadow-md space-y-3">
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/20 text-xs font-semibold backdrop-blur-xs">
            <BrainCircuit className="w-3.5 h-3.5" />
            <span>互動問答 ‧ 考考你</span>
          </div>
          <span className="text-xs font-bold bg-white/20 px-3 py-1 rounded-full">
            目前得分：{score} / {quizQuestions.length}
          </span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
          常見問題知識測驗小學堂
        </h1>
        <p className="text-xs sm:text-sm text-white/80 leading-relaxed">
          透過有趣的單選測驗，輕鬆了解退換貨、配送、付款與會員權益！看看你能拿幾分？
        </p>
      </div>

      {!isQuizCompleted && currentFaq ? (
        <div className="milk-tea-card rounded-3xl p-6 sm:p-8 space-y-6">
          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-semibold text-[#7A6C65]">
              <span>
                第 {currentIndex + 1} 題 / 共 {quizQuestions.length} 題
              </span>
              <span>進度：{Math.round(((currentIndex + 1) / quizQuestions.length) * 100)}%</span>
            </div>
            <div className="w-full bg-[#F2EBE1] h-2.5 rounded-full overflow-hidden">
              <div
                className="bg-[#8C6D53] h-full transition-all duration-300 rounded-full"
                style={{ width: `${((currentIndex + 1) / quizQuestions.length) * 100}%` }}
              />
            </div>
          </div>

          {/* Question Box */}
          <div className="space-y-2">
            <div className="inline-block px-2.5 py-0.5 rounded-full bg-[#F3E8DC] text-[#7A5230] text-xs font-semibold border border-[#E6D4C2]">
              {currentFaq.category}
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-[#3A2E2B] leading-snug">
              {currentFaq.question}
            </h2>
          </div>

          {/* Option List */}
          <div className="space-y-3">
            {currentFaq.options?.map((option, idx) => {
              const isSelected = selectedOption === idx;
              const isCorrect = idx === currentFaq.correctOptionIndex;
              const showResult = selectedOption !== null;

              let btnStyle =
                'bg-[#FCFAF6] border-[#E8DFD3] text-[#3A2E2B] hover:bg-[#F4ECE1] hover:border-[#8C6D53]';

              if (showResult) {
                if (isCorrect) {
                  btnStyle = 'bg-emerald-50 border-emerald-500 text-emerald-900 font-semibold ring-2 ring-emerald-200';
                } else if (isSelected && !isCorrect) {
                  btnStyle = 'bg-rose-50 border-rose-500 text-rose-900 font-semibold ring-2 ring-rose-200';
                } else {
                  btnStyle = 'bg-white opacity-50 border-[#E8DFD3] text-[#7A6C65]';
                }
              }

              return (
                <button
                  key={idx}
                  disabled={showResult}
                  onClick={() => handleSelectOption(idx)}
                  className={`w-full text-left p-4 rounded-2xl border text-sm sm:text-base transition-all flex items-center justify-between gap-3 ${btnStyle}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="w-7 h-7 rounded-full bg-[#E8DFD3]/60 flex items-center justify-center text-xs font-bold shrink-0">
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span>{option}</span>
                  </div>

                  {showResult && isCorrect && (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  )}
                  {showResult && isSelected && !isCorrect && (
                    <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Explanation Box when Answered */}
          {selectedOption !== null && (
            <div className="p-5 rounded-2xl bg-[#FCFAF6] border border-[#E8DFD3] space-y-3 animate-fade-in">
              <div className="flex items-center gap-2 font-bold text-sm">
                {selectedOption === currentFaq.correctOptionIndex ? (
                  <span className="text-emerald-700 flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4" /> 回答正確！
                  </span>
                ) : (
                  <span className="text-rose-700 flex items-center gap-1">
                    <XCircle className="w-4 h-4" /> 差一點點！
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm text-[#4A3D39] leading-relaxed">
                <strong>詳細解析：</strong>
                {currentFaq.explanation || currentFaq.answer}
              </p>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={handleNextQuestion}
                  className="milk-tea-btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2"
                >
                  <span>{currentIndex < quizQuestions.length - 1 ? '下一題' : '查看小學堂總成績'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Quiz Completion Summary Screen */
        <div className="milk-tea-card rounded-3xl p-8 sm:p-12 text-center space-y-6 animate-fade-in">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-gradient-to-tr from-amber-200 to-amber-100 flex items-center justify-center text-amber-800 shadow-md">
            <Trophy className="w-10 h-10" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-[#3A2E2B]">
              測驗挑戰完成！
            </h2>
            <p className="text-sm text-[#7A6C65]">
              恭喜您順利完成所有常見問題小學堂測試！
            </p>
          </div>

          <div className="inline-block p-6 rounded-2xl bg-[#F4ECE1] border border-[#E4D8C8] space-y-1">
            <span className="text-xs text-[#7A6C65] font-medium uppercase tracking-wider">
              最終成績表現
            </span>
            <div className="text-4xl font-extrabold text-[#8C6D53]">
              {score} <span className="text-lg text-[#7A6C65] font-normal">/ {quizQuestions.length} 題</span>
            </div>
            <p className="text-xs text-[#7A5230] pt-1 font-medium">
              答對率：{Math.round((score / quizQuestions.length) * 100)}%
            </p>
          </div>

          <div className="pt-2 flex justify-center gap-3">
            <button
              onClick={handleRestartQuiz}
              className="milk-tea-btn-primary px-6 py-3 rounded-xl text-sm font-semibold inline-flex items-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              重新挑戰一次
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
