import React, { useState, useEffect } from "react";
import BookSelector from "./components/BookSelector";
import ReaderDashboard from "./components/ReaderDashboard";
import { BookJourney, StartJourneyRequest } from "./types";
import { Sparkles, Library } from "lucide-react";

const INSPIRATIONAL_QUOTES = [
  "“光用眼睛看是看不明白的。只有用心灵，才能看清事物的本质。” ——《小王子》",
  "“满地都是六便士，他却抬头看见了月亮。” ——《月亮与六便士》",
  "“谁控制过去就控制未来；谁控制现在就控制过去。” ——《1984》",
  "“兵者，国之大事，死生之地，存亡之道，不可不察也。” ——《孙子兵法》",
  "“世界上只有一种真正的英雄主义，那就是认清生活的真相后依然热爱生活。” —— 罗曼·罗兰",
  "“有些书只需品尝，有些书可以吞食，而少数书则需要咀嚼和消化。” —— 培根"
];

export default function App() {
  const [journey, setJourney] = useState<BookJourney | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [quoteIndex, setQuoteIndex] = useState(0);

  // Cycle inspirational literary quotes on loading splash
  useEffect(() => {
    if (!isLoading) return;
    const interval = setInterval(() => {
      setQuoteIndex((prev) => (prev + 1) % INSPIRATIONAL_QUOTES.length);
    }, 4500);
    return () => clearInterval(interval);
  }, [isLoading]);

  // Handle start journey POST query to the full-stack server
  const handleStartJourney = async (params: StartJourneyRequest) => {
    setIsLoading(true);
    setQuoteIndex(Math.floor(Math.random() * INSPIRATIONAL_QUOTES.length));

    try {
      const res = await fetch("/api/start-journey", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || "无法启动伴读。请检查服务端连接。");
      }

      const data = await res.json();

      // Setup clean client-side session states
      const newJourney: BookJourney = {
        id: Date.now().toString(),
        title: data.title,
        author: data.author,
        totalDays: data.totalDays,
        schedule: data.schedule,
        userAnswers: {},
        userNotes: {},
        chatHistories: {},
        currentDay: 1,
      };

      setJourney(newJourney);
    } catch (err: any) {
      alert("伴读舱初始化故障：" + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateJourney = (updated: BookJourney) => {
    setJourney(updated);
  };

  const handleExitJourney = () => {
    if (confirm("确定要离开当前共学日程吗？未导出的每日随笔和草稿可能会丢失。")) {
      setJourney(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#f7f6f2] text-stone-900 selection:bg-amber-100 flex flex-col justify-between">
      
      {/* Dynamic Main Board */}
      <main className="flex-1 w-full">
        {isLoading ? (
          <div className="fixed inset-0 bg-[#faf9f5] z-50 flex flex-col items-center justify-center p-6 text-center animate-fade-in">
            <div className="relative">
              <div className="absolute inset-0 rounded-full border-4 border-amber-900/10 animate-ping" />
              <div className="relative bg-amber-50 border border-amber-950/10 w-20 h-20 flex items-center justify-center rounded-2xl shadow-sm mb-8 animate-pulse text-3xl">
                📖
              </div>
            </div>

            <div className="space-y-4 max-w-lg md:max-w-xl mx-auto">
              <h3 className="text-xl font-serif font-bold text-stone-800 flex items-center justify-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-800 animate-spin" />
                <span>AI 正在为您排布与构思精修伴学计划...</span>
              </h3>
              
              <div className="h-24 flex items-center justify-center">
                <p className="text-stone-500 font-serif italic text-sm md:text-base leading-relaxed animate-fade-in px-4">
                  {INSPIRATIONAL_QUOTES[quoteIndex]}
                </p>
              </div>

              <div className="pt-2">
                <span className="text-2xs font-mono text-stone-400 tracking-widest uppercase">
                  Google Gemini 认知核心 · 正在深度定制 3D 研习维度
                </span>
              </div>
            </div>
          </div>
        ) : journey ? (
          <ReaderDashboard 
            journey={journey} 
            onChangeJourney={handleUpdateJourney} 
            onExit={handleExitJourney} 
          />
        ) : (
          <BookSelector 
            onStartJourney={handleStartJourney} 
            isLoading={isLoading} 
          />
        )}
      </main>

      {/* Outer Site margins/Anti-AI Slop minimal styled footer (shown only on selection page) */}
      {!journey && !isLoading && (
        <footer className="py-8 bg-stone-900/5 border-t border-stone-200/50 text-center font-sans">
          <p className="text-xs text-stone-400 font-medium">
            © {new Date().getFullYear()} AI Reading Companion · 智能伴学研习空间
          </p>
          <p className="text-[10px] text-stone-400 mt-1">
            智能语义日程划分体系 · 支持 PDF 文档、书籍链接与正文拼贴
          </p>
        </footer>
      )}

    </div>
  );
}
