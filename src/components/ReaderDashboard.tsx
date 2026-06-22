import React, { useState, useRef, useEffect } from "react";
import { BookJourney, ChatMessage } from "../types";
import { 
  ChevronLeft, BookOpen, Send, Sparkles, Download, 
  HelpCircle, Globe, Edit3, MessageSquare, ZoomIn, ZoomOut, CheckCircle2, RotateCcw,
  Languages, PenTool, Check, Trash2, Plus
} from "lucide-react";

interface ReaderDashboardProps {
  journey: BookJourney;
  onChangeJourney: (updated: BookJourney) => void;
  onExit: () => void;
}

export default function ReaderDashboard({ journey, onChangeJourney, onExit }: ReaderDashboardProps) {
  const [activeTab, setActiveTab] = useState<"recall" | "chat">("recall");
  const [readerSubTab, setReaderSubTab] = useState<"overview" | "reading" | "reflection">("overview");
  const [fontSize, setFontSize] = useState<number>(18); // default serif text size
  const [chatInput, setChatInput] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  
  // Comparative reader modes: "pure" (original text), "translation" (side-by-side white-paper translation), "study" (expert annotating margin & tips)
  const [excerptViewMode, setExcerptViewMode] = useState<"pure" | "translation" | "study">("pure");
  const [isGeneratingAnnotations, setIsGeneratingAnnotations] = useState(false);
  const [editingAnnotationParaIdx, setEditingAnnotationParaIdx] = useState<number | null>(null);
  const [currentAnnotationInput, setCurrentAnnotationInput] = useState("");

  const chatBottomRef = useRef<HTMLDivElement>(null);

  const currentDayIndex = journey.currentDay;
  const activeDay = journey.schedule.find((d) => d.day === currentDayIndex) || journey.schedule[0];

  // Sync scroll for chat companion
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [journey.chatHistories[currentDayIndex]]);

  // Trigger Gemini API to generate annotations
  const handleGenerateAnnotations = async () => {
    if (isGeneratingAnnotations) return;
    setIsGeneratingAnnotations(true);
    try {
      const res = await fetch("/api/generate-annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookTitle: journey.title,
          dayTitle: activeDay.title,
          excerpt: activeDay.excerpt,
        }),
      });

      if (!res.ok) {
        throw new Error("生成对勘标注失败，请检查网络后重试。");
      }

      const data = await res.json();

      const updatedSchedule = journey.schedule.map((day) => {
        if (day.day === currentDayIndex) {
          return {
            ...day,
            modernParaphrase: data.modernParaphrase,
            expertAnnotations: data.expertAnnotations,
          };
        }
        return day;
      });

      onChangeJourney({
        ...journey,
        schedule: updatedSchedule,
      });
    } catch (err: any) {
      alert("智能批注对勘生成故障：" + err.message);
    } finally {
      setIsGeneratingAnnotations(false);
    }
  };

  // Saved user paragraph-by-paragraph annotations
  const handleSaveUserParagraphAnnotation = (pIdx: number, text: string) => {
    const updatedAnnotations = journey.userParagraphAnnotations ? { ...journey.userParagraphAnnotations } : {};
    if (!updatedAnnotations[currentDayIndex]) {
      updatedAnnotations[currentDayIndex] = {};
    }

    if (text.trim() === "") {
      delete updatedAnnotations[currentDayIndex][pIdx];
    } else {
      updatedAnnotations[currentDayIndex][pIdx] = text;
    }

    onChangeJourney({
      ...journey,
      userParagraphAnnotations: updatedAnnotations,
    });
    setEditingAnnotationParaIdx(null);
    setCurrentAnnotationInput("");
  };

  // Manage Active Recall text answers
  const handleAnswerChange = (qIdx: number, val: string) => {
    const updatedAnswers = { ...journey.userAnswers };
    if (!updatedAnswers[currentDayIndex]) {
      updatedAnswers[currentDayIndex] = ["", "", ""];
    }
    updatedAnswers[currentDayIndex][qIdx] = val;
    onChangeJourney({
      ...journey,
      userAnswers: updatedAnswers,
    });
  };

  // Manage Personal Notes
  const handleNoteChange = (val: string) => {
    const updatedNotes = { ...journey.userNotes };
    updatedNotes[currentDayIndex] = val;
    onChangeJourney({
      ...journey,
      userNotes: updatedNotes,
    });
  };

  // Handle direct AI Chat assistant proxy
  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const userMsg = chatInput.trim();
    setChatInput("");

    const dayChat = journey.chatHistories[currentDayIndex] || [];
    const newChatHistories = { ...journey.chatHistories };
    newChatHistories[currentDayIndex] = [
      ...dayChat,
      { role: "user", parts: userMsg }
    ];

    // Optimistically update frontend UI
    const tempUpdatedJourney = {
      ...journey,
      chatHistories: newChatHistories,
    };
    onChangeJourney(tempUpdatedJourney);
    setIsChatLoading(true);

    try {
      const res = await fetch("/api/chat-companion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookTitle: journey.title,
          totalDays: journey.totalDays,
          currentDay: currentDayIndex,
          dayTitle: activeDay.title,
          daySummary: activeDay.summary,
          dayExcerpt: activeDay.excerpt,
          history: newChatHistories[currentDayIndex].slice(0, -1), // skip current message
          userMessage: userMsg,
        }),
      });

      if (!res.ok) {
        throw new Error("Tutor failed to respond");
      }

      const data = await res.json();
      
      newChatHistories[currentDayIndex] = [
        ...newChatHistories[currentDayIndex],
        { role: "model", parts: data.reply }
      ];

      onChangeJourney({
        ...journey,
        chatHistories: newChatHistories,
      });
    } catch (err: any) {
      console.error(err);
      newChatHistories[currentDayIndex] = [
        ...newChatHistories[currentDayIndex],
        { role: "model", parts: "伴读导师走神了，请检查网络连接或稍后再试。" }
      ];
      onChangeJourney({
        ...journey,
        chatHistories: newChatHistories,
      });
    } finally {
      setIsChatLoading(false);
    }
  };

  // Export full HTML Editorial Journal
  const handleExportJournal = async () => {
    if (isDownloading) return;
    setIsDownloading(true);

    try {
      const res = await fetch("/api/generate-journal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bookTitle: journey.title,
          author: journey.author,
          totalDays: journey.totalDays,
          schedule: journey.schedule,
          userAnswers: journey.userAnswers,
          userNotes: journey.userNotes,
          chatHistories: journey.chatHistories,
        })
      });

      if (!res.ok) {
        throw new Error("Unable to download report");
      }

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${journey.title}_共读周报_${new Date().toLocaleDateString("zh-CN")}.html`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      alert("生成周刊期刊失败：" + err.message);
    } finally {
      setIsDownloading(false);
    }
  };

  const activeAnswers = journey.userAnswers[currentDayIndex] || ["", "", ""];
  const activeNotes = journey.userNotes[currentDayIndex] || "";
  const activeChats = journey.chatHistories[currentDayIndex] || [];

  return (
    <div className="w-full min-h-screen bg-[#f5f4ef] flex flex-col md:flex-row font-sans relative">
      
      {/* LEFT COLUMN: Sidebar Day list Selector */}
      <div className="w-full md:w-64 bg-stone-900 text-stone-200 flex flex-col border-r border-stone-800 flex-shrink-0 md:sticky md:top-0 md:h-screen md:overflow-y-auto">
        
        {/* Header brand details */}
        <div className="p-6 border-b border-stone-800 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">🌟</span>
            <span className="font-serif font-black tracking-wider text-amber-100 text-lg">AI STUDY SPACE</span>
          </div>
          <div className="text-xs text-stone-400 mt-1 line-clamp-1 truncate" title={journey.title}>
            当前：《{journey.title}》
          </div>
        </div>

        {/* Dynamic Days list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
          <p className="text-stone-500 text-xs font-bold uppercase tracking-widest px-2 mb-3">
            共读日程轴
          </p>
          {journey.schedule.map((day) => {
            const isCompleted = (journey.userAnswers[day.day] || []).filter(a => a.trim().length > 0).length >= 1;
            const isActive = day.day === currentDayIndex;

            return (
              <button
                key={day.day}
                onClick={() => onChangeJourney({ ...journey, currentDay: day.day })}
                className={`w-full text-left p-3 rounded-xl flex items-center justify-between transition-all ${
                  isActive
                    ? "bg-amber-900 text-white shadow-md font-medium"
                    : "hover:bg-stone-800 text-stone-300"
                }`}
              >
                <div className="flex flex-col">
                  <span className={`text-2xs uppercase tracking-widest font-mono ${isActive ? "text-amber-200" : "text-stone-500"}`}>
                    DAY {day.day}
                  </span>
                  <span className="text-sm font-serif line-clamp-1 mt-0.5" title={day.title}>
                    {day.title}
                  </span>
                </div>
                {isCompleted && (
                  <CheckCircle2 className={`w-4 h-4 ${isActive ? "text-amber-200" : "text-emerald-500"}`} />
                )}
              </button>
            );
          })}
        </div>

        {/* Left Side bottom menu actions */}
        <div className="p-4 border-t border-stone-800 space-y-2">
          <button
            onClick={handleExportJournal}
            disabled={isDownloading}
            className="w-full flex items-center justify-center gap-2 bg-amber-800 text-white hover:bg-amber-700 active:scale-[0.98] transition-all py-3 px-4 rounded-xl text-sm font-serif font-bold shadow-sm"
          >
            {isDownloading ? (
              <>
                <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                <span>生成中...</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                <span>生成精装周刊</span>
              </>
            )}
          </button>
          
          <button
            onClick={onExit}
            className="w-full flex items-center justify-center gap-2 bg-stone-800 text-stone-400 hover:bg-stone-700 hover:text-stone-200 active:scale-[0.98] transition-all py-2.5 px-4 rounded-xl text-xs font-semibold"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>回到书架</span>
          </button>
        </div>
      </div>

      {/* MIDDLE COLUMN: Clean Reader View (Medium styling) */}
      <div className="flex-1 flex flex-col bg-white border-r border-stone-200 overflow-y-auto">
        
        {/* Reader Top Bar (utilities) */}
        <div className="sticky top-0 bg-white/95 backdrop-blur-md px-6 py-4 border-b border-stone-100 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <span className="text-[10px] md:text-xs font-serif text-stone-500 bg-stone-100 px-2.5 py-1 rounded">
              DAY {activeDay.day} / {journey.totalDays}
            </span>
            <span className="text-stone-300">|</span>
            <span className="text-xs md:text-sm font-sans font-medium text-stone-600 truncate max-w-xs md:max-w-sm">
              主题：{activeDay.title}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setFontSize(prev => Math.max(14, prev - 2))}
              className="p-1.5 hover:bg-stone-100 rounded-lg text-stone-600 transition-colors"
              title="减小字号"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs text-stone-400 font-mono w-8 text-center">{fontSize}px</span>
            <button
              onClick={() => setFontSize(prev => Math.min(26, prev + 2))}
              className="p-1.5 hover:bg-stone-100 rounded-lg text-stone-600 transition-colors"
              title="增大字号"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Dynamic Reader Sub-Tabs */}
        <div className="flex border-b border-stone-200 bg-stone-50/50 p-1 z-10 sticky top-[53px]">
          <button
            onClick={() => setReaderSubTab("overview")}
            className={`flex-1 py-1.5 text-center font-serif text-xs font-bold transition-all rounded-lg flex items-center justify-center gap-1.5 ${
              readerSubTab === "overview"
                ? "bg-white text-stone-900 shadow-2xs border border-stone-200/50"
                : "text-stone-500 hover:text-stone-800"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-800" />
            <span>简读导览</span>
          </button>
          <button
            onClick={() => setReaderSubTab("reading")}
            className={`flex-1 py-1.5 text-center font-serif text-xs font-bold transition-all rounded-lg flex items-center justify-center gap-1.5 ${
              readerSubTab === "reading"
                ? "bg-white text-stone-900 shadow-2xs border border-stone-200/50"
                : "text-stone-500 hover:text-stone-800"
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 text-stone-600" />
            <span>原著精读</span>
          </button>
          <button
            onClick={() => setReaderSubTab("reflection")}
            className={`flex-1 py-1.5 text-center font-serif text-xs font-bold transition-all rounded-lg flex items-center justify-center gap-1.5 relative ${
              readerSubTab === "reflection"
                ? "bg-white text-stone-900 shadow-2xs border border-stone-200/50"
                : "text-stone-500 hover:text-stone-800"
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
            <span>深度复盘</span>
          </button>
        </div>

        {/* Main Reader Sheet */}
        <div className="px-4 md:px-8 py-5 max-w-3xl mx-auto w-full space-y-5">
          
          {/* Day Title & metadata */}
          <div className="border-b border-stone-100 pb-4 text-center md:text-left">
            <h1 className="font-serif font-bold text-2xl md:text-3xl text-stone-900 leading-tight">
              {activeDay.title}
            </h1>
            <div className="mt-2 flex flex-wrap items-center justify-center md:justify-start gap-4 text-xs text-stone-500 font-sans">
              <span>阅读日程：第 {activeDay.day} 天</span>
              <span>•</span>
              <span>分配正文字数：约 {activeDay.wordCount || "名著核心摘要"} 字</span>
            </div>
          </div>

          {/* Sub-tab 1: Overview */}
          {readerSubTab === "overview" && (
            <div className="space-y-6">
              {/* Day Summary Review card */}
              <div className="bg-amber-50/20 border border-amber-900/10 rounded-xl p-5 relative select-text shadow-sm">
                <div className="absolute top-0 right-0 p-3 font-serif text-stone-300/30 text-5xl select-none pointer-events-none">
                  📜
                </div>
                <h3 className="font-serif text-xs font-bold text-[#8c6239] mb-3 tracking-wider uppercase border-b border-amber-900/5 pb-2">
                  伴读名家导读 & 重点提炼
                </h3>
                <p className="font-sans text-stone-700 leading-relaxed text-xs md:text-sm text-justify">
                  {activeDay.summary}
                </p>
              </div>
              
              {/* Pre-reading hints */}
              {activeDay.hints && activeDay.hints.length > 0 && (
                <div className="bg-white border border-stone-200 rounded-xl p-5 shadow-sm">
                  <h4 className="text-xs font-bold font-sans uppercase text-stone-400 tracking-widest mb-3 flex items-center gap-1">
                    📚 今日关键预习概念
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {activeDay.hints.map((hint, idx) => (
                      <span 
                        key={idx} 
                        className="px-3 py-1.5 bg-stone-50 rounded-lg border border-stone-200/50 text-stone-700 text-xs font-medium font-serif"
                      >
                        {hint}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Deep Story Analyses */}
              {activeDay.storyAnalyses && activeDay.storyAnalyses.length > 0 ? (
                <div className="space-y-4 pt-1">
                  {activeDay.storyAnalyses.map((story, sIdx) => (
                    <div key={sIdx} className="bg-stone-50/50 border border-stone-200 rounded-xl p-4 md:p-5 space-y-3.5 select-text shadow-sm">
                      <div className="border-b border-stone-200 pb-2 flex items-center justify-between">
                        <h4 className="font-serif font-bold text-sm md:text-base text-stone-950">
                          {sIdx + 1}. 《{story.storyName}》深度剖析
                        </h4>
                      </div>
                      
                      <div className="space-y-3 text-xs text-stone-700 leading-relaxed select-text font-sans">
                        <div className="relative pl-3 border-l-2 border-stone-300">
                          <span className="font-sans font-bold text-stone-800 text-[10px] block uppercase tracking-wider mb-0.5">
                            🏛️ 时代阶级与大环境
                          </span>
                          <p className="font-serif text-stone-600 text-justify">{story.background}</p>
                        </div>
                        <div className="relative pl-3 border-l-2 border-stone-300">
                          <span className="font-sans font-bold text-stone-800 text-[10px] block uppercase tracking-wider mb-0.5">
                            🧠 人物心理与挣扎
                          </span>
                          <p className="font-serif text-stone-600 text-justify">{story.psychology}</p>
                        </div>
                        <div className="relative pl-3 border-l-2 border-stone-300">
                          <span className="font-sans font-bold text-stone-800 text-[10px] block uppercase tracking-wider mb-0.5">
                            👑 社会政治地位
                          </span>
                          <p className="font-serif text-stone-600 text-justify">{story.socialStatus}</p>
                        </div>
                        <div className="relative pl-3 border-l-2 border-stone-300">
                          <span className="font-sans font-bold text-stone-800 text-[10px] block uppercase tracking-wider mb-0.5">
                            🕸️ 权力与人际关系冲突
                          </span>
                          <p className="font-serif text-stone-600 text-justify">{story.socialRelations}</p>
                        </div>
                      </div>

                      <div className="bg-[#faf8f4] border-t border-stone-200/60 -mx-4 -mb-4 md:-mx-5 md:-mb-5 p-3.5 md:p-4 rounded-b-xl mt-2 select-text">
                        <span className="font-sans font-bold text-amber-900 flex items-center gap-1 text-[11px] mb-1">
                          💡 核心故事义理
                        </span>
                        <p className="font-serif text-stone-800 text-xs md:text-sm leading-relaxed text-justify whitespace-normal">
                          {story.essence}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {/* Sub-tab 2: Excerpt and Guide */}
          {readerSubTab === "reading" && (
            <div className="space-y-4">
              {/* Book Excerpt with Comparison & Annotations */}
              <div className="space-y-4">
                
                {/* Mode Selector Top Rail */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-stone-200/80 pb-3">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-amber-800" />
                    <h3 className="font-serif text-sm font-bold text-stone-800">
                      原本研习与批注对勘
                    </h3>
                  </div>
                  
                  <div className="flex bg-stone-100 p-1 rounded-xl text-2xs font-bold font-sans self-start">
                    <button
                      onClick={() => setExcerptViewMode("pure")}
                      className={`px-3 py-1.5 rounded-lg transition-all ${
                        excerptViewMode === "pure"
                          ? "bg-white text-stone-900 shadow-3xs"
                          : "text-stone-500 hover:text-stone-800"
                      }`}
                    >
                      原本阅读
                    </button>
                    <button
                      onClick={() => setExcerptViewMode("translation")}
                      className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                        excerptViewMode === "translation"
                          ? "bg-white text-stone-900 shadow-3xs"
                          : "text-stone-500 hover:text-stone-800"
                      }`}
                    >
                      <Languages className="w-3 h-3 text-stone-500" />
                      <span>白话智译对照</span>
                    </button>
                    <button
                      onClick={() => setExcerptViewMode("study")}
                      className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                        excerptViewMode === "study"
                          ? "bg-white text-stone-900 shadow-3xs"
                          : "text-stone-500 hover:text-stone-800"
                      }`}
                    >
                      <PenTool className="w-3 h-3 text-stone-500" />
                      <span>研析随笔批注</span>
                    </button>
                  </div>
                </div>

                {/* Main Content Render Box */}
                {!activeDay.excerpt ? (
                  <div className="bg-[#faf9f5] border border-stone-200/60 p-6 rounded-xl text-center font-serif text-stone-500 italic text-xs leading-relaxed">
                    经典名著对应章节导读：本书已被AI伴学系统全面感知。请带着侧边的“预习提示”精学今天的高品位摘要与主干观点。
                  </div>
                ) : (excerptViewMode === "translation" || excerptViewMode === "study") && (!activeDay.modernParaphrase || activeDay.modernParaphrase.length === 0) ? (
                  /* Generation Onboarding placeholder if translations do not exist yet */
                  <div className="bg-amber-50/15 border border-dashed border-amber-900/20 rounded-2xl p-6 text-center space-y-4">
                    <div className="w-12 h-12 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto text-lg border border-amber-900/10">
                      ⚡
                    </div>
                    <div className="max-w-md mx-auto space-y-1.5">
                      <h4 className="font-serif font-bold text-sm text-stone-950">
                        开启 “原本白话智译对照” 及 “深度名师考证批注”
                      </h4>
                      <p className="font-sans text-xs text-stone-600 leading-relaxed">
                        系统已深度感知当前章节。点击下方按钮，伴读学者将启动“句段对勘与隐喻解构”进程，为您针对每一个正文段落生成：即时白话译文、名家边栏批注。开启后批注信息将永久保存在您的研学日志中。
                      </p>
                    </div>
                    <button
                      onClick={handleGenerateAnnotations}
                      disabled={isGeneratingAnnotations}
                      className="inline-flex items-center gap-2 bg-amber-900 hover:bg-stone-900 text-white font-serif text-xs font-bold py-2.5 px-6 rounded-xl shadow-xs transition-all active:scale-[0.98] disabled:opacity-50"
                    >
                      {isGeneratingAnnotations ? (
                        <>
                          <span className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent" />
                          <span>伴学者执笔破译段落理路中...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5 text-amber-200 animate-pulse" />
                          <span>开启智能对勘与注释</span>
                        </>
                      )}
                    </button>
                  </div>
                ) : (
                  /* Render Excerpts according to current selected mode */
                  <div className="space-y-4 select-text">
                    {activeDay.excerpt.split(/\n\n+/).map((para, pIdx) => {
                      const trimmedPara = para.trim();
                      if (!trimmedPara) return null;

                      // Load AI counterparts if available
                      const translationText = activeDay.modernParaphrase?.[pIdx];
                      const expertAnnotationText = activeDay.expertAnnotations?.[pIdx];
                      
                      // Load customized user margin annotates
                      const userAnnotation = journey.userParagraphAnnotations?.[currentDayIndex]?.[pIdx];

                      if (excerptViewMode === "pure") {
                        /* Mode 1: Pure Original View */
                        return (
                          <div key={pIdx} className="bg-[#faf9f5] border border-stone-200/50 p-5 rounded-xl block transition-all hover:border-stone-300">
                            <p 
                              style={{ fontSize: `${fontSize}px` }} 
                              className="font-serif text-stone-800 leading-relaxed text-justify selection:bg-amber-100"
                            >
                              {trimmedPara}
                            </p>
                          </div>
                        );
                      } else if (excerptViewMode === "translation") {
                        /* Mode 2: Paragraph Comparison */
                        return (
                          <div key={pIdx} className="grid grid-cols-1 md:grid-cols-2 gap-4 border border-stone-200/80 rounded-xl overflow-hidden shadow-3xs transition-all hover:shadow-2xs">
                            {/* Left: Original Text */}
                            <div className="bg-[#faf9f5] p-5 border-b md:border-b-0 md:border-r border-stone-200/50">
                              <span className="text-[9px] uppercase tracking-wider font-sans font-bold text-stone-400 block mb-2">
                                原本正文 #{pIdx + 1}
                              </span>
                              <p 
                                style={{ fontSize: `${fontSize - 1}px` }} 
                                className="font-serif text-stone-800 leading-relaxed text-justify"
                              >
                                {trimmedPara}
                              </p>
                            </div>
                            
                            {/* Right: Modern Simplified Trans */}
                            <div className="bg-stone-50/50 p-5 flex flex-col justify-between">
                              <div>
                                <span className="text-[9px] uppercase tracking-wider font-sans font-bold text-amber-800 block mb-2">
                                  💡 白话智译与核心论点对照
                                </span>
                                <p className="font-sans text-[13px] text-stone-600 leading-relaxed text-justify whitespace-pre-line">
                                  {translationText || "名家正在斟酌本段义理..."}
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      } else {
                        /* Mode 3: Annotation Margins */
                        const isEditingThis = editingAnnotationParaIdx === pIdx;

                        return (
                          <div key={pIdx} className="bg-[#faf9f5] border border-stone-200 rounded-xl p-5 space-y-3.5 transition-all hover:border-stone-300">
                            {/* Original Content block */}
                            <div>
                              <p 
                                style={{ fontSize: `${fontSize}px` }} 
                                className="font-serif text-stone-900 leading-relaxed text-justify border-b border-stone-100 pb-2.5"
                              >
                                {trimmedPara}
                              </p>
                            </div>

                            {/* Annotations Shelf */}
                            <div className="space-y-2.5">
                              {/* 1. Expert Scholar Notes */}
                              {expertAnnotationText && (
                                <div className="bg-amber-50/30 border-l-2 border-amber-700/60 px-3.5 py-2.5 rounded-r-lg space-y-1">
                                  <span className="text-[10px] tracking-wider font-sans font-bold text-[#8c6239] block uppercase">
                                    📜 伴读者批注提示 & 典籍考证
                                  </span>
                                  <p className="font-sans text-xs text-stone-700 leading-relaxed text-justify italic font-serif">
                                    “{expertAnnotationText}”
                                  </p>
                                </div>
                              )}

                              {/* 2. Personal Annotations */}
                              {userAnnotation ? (
                                <div className="bg-[#faf8f4] border border-dashed border-amber-900/20 p-3.5 rounded-lg flex flex-col gap-2 relative">
                                  <div className="flex items-start justify-between gap-4">
                                    <div className="space-y-1">
                                      <span className="text-[10px] font-sans font-bold text-stone-500 block uppercase">
                                        ✍️ 我的手书研学批注
                                      </span>
                                      <p className="font-sans text-xs text-stone-800 leading-relaxed text-justify">
                                        {userAnnotation}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-1.5 flex-shrink-0">
                                      <button
                                        onClick={() => {
                                          setEditingAnnotationParaIdx(pIdx);
                                          setCurrentAnnotationInput(userAnnotation);
                                        }}
                                        className="text-[10px] text-stone-500 hover:text-amber-800 font-bold"
                                      >
                                        修改
                                      </button>
                                      <span className="text-stone-300">|</span>
                                      <button
                                        onClick={() => handleSaveUserParagraphAnnotation(pIdx, "")}
                                        className="text-[10px] text-stone-400 hover:text-red-500 font-bold"
                                      >
                                        删除
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                !isEditingThis && (
                                  <button
                                    onClick={() => {
                                      setEditingAnnotationParaIdx(pIdx);
                                      setCurrentAnnotationInput("");
                                    }}
                                    className="inline-flex items-center gap-1.5 text-[11px] font-sans font-semibold text-stone-500 hover:text-amber-800 bg-stone-100/50 hover:bg-stone-100 py-1 px-2.5 rounded-lg transition-colors"
                                  >
                                    <Plus className="w-3 h-3" />
                                    <span>添加我的手书随笔批注</span>
                                  </button>
                                )
                              )}

                              {/* 3. Editing Textbox */}
                              {isEditingThis && (
                                <div className="bg-white border border-stone-300 rounded-lg p-3 space-y-2 mt-2 shadow-sm">
                                  <span className="text-[10px] font-sans font-bold text-stone-400 block uppercase">
                                    撰写正文第 #{pIdx + 1} 段研习心得
                                  </span>
                                  <textarea
                                    rows={3}
                                    placeholder="在此自由写下你对本段话的批注、疑问或体悟，点击保存后将常驻在正文下方..."
                                    value={currentAnnotationInput}
                                    onChange={(e) => setCurrentAnnotationInput(e.target.value)}
                                    className="w-full text-xs font-sans text-stone-800 border bg-stone-50 rounded-md resize-none focus:outline-none focus:ring-0 p-2.5"
                                  />
                                  <div className="flex items-center justify-end gap-2 text-2xs font-bold pt-1 border-t border-stone-100">
                                    <button
                                      onClick={() => {
                                        setEditingAnnotationParaIdx(null);
                                        setCurrentAnnotationInput("");
                                      }}
                                      className="px-2.5 py-1 text-stone-500 hover:text-stone-800"
                                    >
                                      取消
                                    </button>
                                    <button
                                      onClick={() => handleSaveUserParagraphAnnotation(pIdx, currentAnnotationInput)}
                                      className="bg-amber-900 hover:bg-stone-900 text-white px-3 py-1.5 rounded-md flex items-center gap-1"
                                    >
                                      <Check className="w-3 h-3" />
                                      <span>保存批注</span>
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      }
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Sub-tab 3: Reflection */}
          {readerSubTab === "reflection" && (
            <div className="space-y-6">
              {/* Active Recall questions */}
              <div className="bg-white border border-stone-250 rounded-2xl p-6 shadow-2xs space-y-5">
                <h4 className="text-sm font-bold font-serif uppercase text-stone-800 tracking-wider flex items-center gap-2 border-b border-stone-100 pb-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  读后主动回想与深度反思 (Active Recall)
                </h4>
                <p className="text-xs text-stone-500 leading-relaxed font-sans">
                  利用您所感到的本天思想印记直接写下想法，巩固记忆。
                </p>
                
                <div className="space-y-5">
                  {activeDay.questions.map((q, idx) => (
                    <div key={idx} className="space-y-2">
                      <label className="block text-sm font-serif font-bold text-stone-800 leading-snug">
                        Q{idx + 1}：{q}
                      </label>
                      <textarea
                        rows={3}
                        placeholder="记录您的理解..."
                        value={activeAnswers[idx] || ""}
                        onChange={(e) => handleAnswerChange(idx, e.target.value)}
                        className="w-full px-4 py-3 bg-stone-50 text-stone-700 border border-stone-200 rounded-xl font-sans focus:outline-none focus:border-amber-800 text-sm placeholder:text-stone-400 leading-relaxed"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Twenty-first Century Modern Connections */}
              <div className="bg-stone-900 border border-stone-800 text-stone-100 rounded-2xl p-6 relative overflow-hidden shadow-md">
                <div className="absolute top-0 right-0 p-4 font-serif text-stone-800 text-8xl select-none pointer-events-none">
                  ⚡
                </div>
                <h4 className="text-sm font-bold font-sans text-amber-300 tracking-wider mb-4 flex items-center gap-2">
                  <Globe className="w-4 h-4" />
                  二十一世纪现代投影与映射
                </h4>
                <p className="font-serif text-stone-200 leading-relaxed text-sm md:text-base text-justify">
                  {activeDay.reflection}
                </p>
                <div className="border-t border-stone-800 pt-4 mt-4">
                  <p className="text-xs uppercase tracking-widest text-amber-300/80 font-bold mb-2">未来宏图展望</p>
                  <p className="font-sans text-stone-400 text-xs md:text-sm leading-relaxed text-justify">
                    {activeDay.outlook}
                  </p>
                </div>
              </div>

              {/* Freeform diary / notes */}
              <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-2xs space-y-3 mt-4">
                <h4 className="text-sm font-bold font-sans uppercase text-stone-600 tracking-widest flex items-center gap-2">
                  <Edit3 className="w-4 h-4" />
                  今日自由感想
                </h4>
                <textarea
                  rows={4}
                  placeholder="在此记录今日灵感随笔、日记或摘抄笔记..."
                  value={activeNotes}
                  onChange={(e) => handleNoteChange(e.target.value)}
                  className="w-full px-4 py-3 bg-stone-50 text-stone-700 border border-stone-200 rounded-xl font-sans focus:outline-none focus:border-amber-800 text-sm placeholder:text-stone-400"
                />
              </div>
            </div>
          )}

        </div>
      </div>

      {/* RIGHT COLUMN: Interaction Cockpit (AI Companion chatbot) */}
      <div className="w-full md:w-105 flex flex-col bg-stone-50 border-l border-stone-200 flex-shrink-0">
        
        {/* Header */}
        <div className="flex border-b border-stone-200 bg-white">
          <div className="flex-1 py-4 text-center font-serif text-sm font-bold transition-all border-b-2 flex items-center justify-center gap-2 border-amber-900 text-amber-900 bg-amber-50/10">
            <MessageSquare className="w-4 h-4" />
            <span>AI 伴读导师追问</span>
          </div>
        </div>

        {/* Live AI Socratic Companion chatbot */}
        <div className="flex-1 flex flex-col min-h-0 bg-stone-50">
            
            {/* Chat guidance top note */}
            <div className="p-4 bg-amber-50/20 border-b border-stone-200 text-2xs text-stone-500 leading-relaxed flex items-start gap-2">
              <Sparkles className="w-4 h-4 text-amber-700 flex-shrink-0" />
              <span>
                正在和今天的<strong>《{journey.title}》</strong>随书伴读导师面对面对谈。您可以随意向他探讨由于这一章所引发的哲理疑惑、思想冲突、或者求证经典细节。
              </span>
            </div>

            {/* Chat logs viewport */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
              {activeChats.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-8 text-center text-stone-400">
                  <span className="text-4xl mb-2">💬</span>
                  <p className="font-serif text-stone-700 text-sm font-semibold">展开第一句思想求证</p>
                  <p className="text-2xs text-stone-400 max-w-[200px] mt-1 leading-relaxed">
                    “提出一个问题，往往比解答一个问题更能拓展灵魂的疆域。”
                  </p>
                </div>
              ) : (
                activeChats.map((msg, idx) => (
                  <div 
                    key={idx} 
                    className={`flex flex-col max-w-[85%] ${
                      msg.role === "user" ? "ml-auto items-end" : "mr-auto items-start"
                    }`}
                  >
                    <span className="text-[10px] text-stone-400 font-medium mb-1 px-1">
                      {msg.role === "user" ? "读者" : "伴读导师"}
                    </span>
                    <div 
                      className={`px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed text-justify ${
                        msg.role === "user"
                          ? "bg-amber-900 text-white rounded-tr-none"
                          : "bg-white text-stone-800 border border-stone-200 rounded-tl-none font-serif"
                      }`}
                    >
                      {msg.parts}
                    </div>
                  </div>
                ))
              )}
              {isChatLoading && (
                <div className="mr-auto max-w-[85%] flex flex-col items-start bg-white p-3 rounded-2xl rounded-tl-none border border-stone-200 shadow-2xs">
                  <span className="text-[10px] text-stone-400 font-medium mb-1">伴读导师正在执笔思索...</span>
                  <div className="flex items-center gap-1.5 py-1 px-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-stone-400 animate-bounce delay-75" />
                    <span className="w-1.5 h-1.5 rounded-full bg-stone-400 animate-bounce delay-150" />
                    <span className="w-1.5 h-1.5 rounded-full bg-stone-400 animate-bounce delay-300" />
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Chat typing board */}
            <form onSubmit={handleSendChatMessage} className="p-3 bg-white border-t border-stone-200 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="向伴读导师深入提问或发表反思..."
                disabled={isChatLoading}
                className="flex-1 px-4 py-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:border-amber-800 text-xs placeholder:text-stone-400"
              />
              <button
                type="submit"
                disabled={!chatInput.trim() || isChatLoading}
                className="p-2.5 bg-amber-900 hover:bg-stone-900 active:scale-95 text-white rounded-xl transition-all disabled:opacity-50 disabled:hover:bg-amber-900"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>

          </div>
      </div>

    </div>
  );
}
