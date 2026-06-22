import React, { useState } from "react";
import { BookOpen, Link2, Upload, FileText, CheckCircle2, ChevronRight, Bookmark } from "lucide-react";
import { PRESET_BOOKS, PresetBook } from "../utils/presets";
import { StartJourneyRequest } from "../types";
import { motion } from "motion/react";

interface BookSelectorProps {
  onStartJourney: (data: StartJourneyRequest) => void;
  isLoading: boolean;
}

export default function BookSelector({ onStartJourney, isLoading }: BookSelectorProps) {
  const [inputType, setInputType] = useState<"preset" | "text" | "url" | "pdf">("preset");
  const [selectedPresetId, setSelectedPresetId] = useState<string>(PRESET_BOOKS[0].id);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [days, setDays] = useState<number>(3);
  const [pastedText, setPastedText] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [pdfBase64, setPdfBase64] = useState<string>("");

  const activePreset = PRESET_BOOKS.find((b) => b.id === selectedPresetId) || PRESET_BOOKS[0];

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadedFileName(file.name);
    
    // Automatically fill in title from filename if empty
    const dotIdx = file.name.lastIndexOf(".");
    const suggestedTitle = dotIdx !== -1 ? file.name.slice(0, dotIdx) : file.name;
    if (!title) setTitle(suggestedTitle);

    if (file.name.toLowerCase().endsWith(".pdf") || file.type === "application/pdf") {
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          const dataUrl = event.target.result as string;
          // Extract base64 part
          const base64Content = dataUrl.split(",")[1];
          setPdfBase64(base64Content);
          setPastedText(""); // Clear plain text if it's a PDF
        }
      };
      reader.readAsDataURL(file);
    } else {
      // Normal plain text/markdown file
      setPdfBase64("");
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          const buffer = event.target.result as ArrayBuffer;
          const uint8 = new Uint8Array(buffer);
          let decodedText = "";
          try {
            // Try UTF-8 with fatal: true to detect non-UTF8 encodings
            const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
            decodedText = utf8Decoder.decode(uint8);
          } catch (e) {
            try {
              // Fallback to GB18030 which is a superset of GBK and GB2312
              const gbkDecoder = new TextDecoder("gb18030");
              decodedText = gbkDecoder.decode(uint8);
            } catch (err2) {
              // Safe fallback
              const fallbackDecoder = new TextDecoder("utf-8");
              decodedText = fallbackDecoder.decode(uint8);
            }
          }
          setPastedText(decodedText);
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (inputType === "preset") {
      onStartJourney({
        title: activePreset.title,
        author: activePreset.author,
        days: days,
        inputType: "preset",
        content: activePreset.fullTextExcerpt,
        presetId: activePreset.id,
      });
    } else {
      if (!title.trim()) {
        alert("请输入书名");
        return;
      }
      onStartJourney({
        title,
        author,
        days: days,
        inputType,
        content: pastedText,
        fileUrl: inputType === "url" ? fileUrl : undefined,
        pdfBase64: inputType === "pdf" ? pdfBase64 : undefined,
      });
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-8">
      <div className="text-center mb-12">
        <span className="px-3 py-1 text-xs tracking-widest uppercase border border-amber-800/30 text-amber-800 font-semibold rounded-full bg-amber-50">
          AI-POWERED CLASSICAL COMPANION
        </span>
        <h2 className="mt-4 text-4xl md:text-5xl font-serif font-bold text-stone-900 tracking-tight leading-tight">
          AI 智能读书陪学空间
        </h2>
        <p className="mt-4 text-stone-600 max-w-2xl mx-auto font-sans leading-relaxed">
          建立阅读微习惯。输入您的阅读目标天数，AI 将为您智能规划每日篇章、生成带着思考预习的启迪知识、引爆记忆的主动回想考题，并将经典共鸣无缝连线现代社会的当下反思。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Side: Creation Panel */}
        <div className="lg:col-span-7 bg-white border border-stone-200 shadow-sm rounded-2xl p-6 md:p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            
            {/* Input Selection Tabs */}
            <div>
              <label className="block text-sm font-semibold text-stone-800 mb-3">
                1. 选择书籍来源方式
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => setInputType("preset")}
                  className={`flex flex-col items-center justify-center py-3 px-2 border rounded-xl font-sans transition-all ${
                    inputType === "preset"
                      ? "border-amber-700 bg-amber-50/50 text-amber-900 shadow-sm"
                      : "border-stone-200 text-stone-600 hover:bg-stone-50"
                  }`}
                >
                  <Bookmark className="w-5 h-5 mb-1" />
                  <span className="text-xs font-medium">经典书单</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInputType("text")}
                  className={`flex flex-col items-center justify-center py-3 px-2 border rounded-xl font-sans transition-all ${
                    inputType === "text"
                      ? "border-amber-700 bg-amber-50/50 text-amber-900 shadow-sm"
                      : "border-stone-200 text-stone-600 hover:bg-stone-50"
                  }`}
                >
                  <FileText className="w-5 h-5 mb-1" />
                  <span className="text-xs font-medium">复制原文</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInputType("url")}
                  className={`flex flex-col items-center justify-center py-3 px-2 border rounded-xl font-sans transition-all ${
                    inputType === "url"
                      ? "border-amber-700 bg-amber-50/50 text-amber-900 shadow-sm"
                      : "border-stone-200 text-stone-600 hover:bg-stone-50"
                  }`}
                >
                  <Link2 className="w-5 h-5 mb-1" />
                  <span className="text-xs font-medium">网页链接</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInputType("pdf")}
                  className={`flex flex-col items-center justify-center py-3 px-2 border rounded-xl font-sans transition-all ${
                    inputType === "pdf"
                      ? "border-amber-700 bg-amber-50/50 text-amber-900 shadow-sm"
                      : "border-stone-200 text-stone-600 hover:bg-stone-50"
                  }`}
                >
                  <Upload className="w-5 h-5 mb-1" />
                  <span className="text-xs font-medium">文本文件</span>
                </button>
              </div>
            </div>

            {/* Render conditional inputs */}
            {inputType === "preset" ? (
              <div className="space-y-4">
                <label className="block text-sm font-semibold text-stone-800">
                  选择推荐的世界经典
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {PRESET_BOOKS.map((book) => (
                    <button
                      key={book.id}
                      type="button"
                      onClick={() => {
                        setSelectedPresetId(book.id);
                        setDays(book.suggestedDays);
                      }}
                      className={`relative text-left p-4 rounded-xl border transition-all ${
                        selectedPresetId === book.id
                          ? "border-amber-700 bg-amber-50/30 text-amber-950 shadow-sm"
                          : "border-stone-200 hover:border-stone-300"
                      }`}
                    >
                      <div className="text-2xl mb-2">{book.coverEmoji}</div>
                      <div className="font-serif font-bold text-sm tracking-tight leading-snug line-clamp-1">
                        {book.title.split(" ")[0]}
                      </div>
                      <div className="font-sans text-stone-500 text-xs mt-1 truncate">
                        {book.author.split("/")[0]}
                      </div>
                      {selectedPresetId === book.id && (
                        <div className="absolute top-2 right-2 text-amber-700">
                          <CheckCircle2 className="w-4 h-4 fill-amber-100" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4 animate-fade-in">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-stone-700 uppercase tracking-widest mb-1">
                      书名 *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="例如：乌合之众、人类简史"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl font-sans focus:outline-none focus:border-amber-800"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-stone-700 uppercase tracking-widest mb-1">
                      著者（可选）
                    </label>
                    <input
                      type="text"
                      placeholder="例如：古斯塔夫·勒庞"
                      value={author}
                      onChange={(e) => setAuthor(e.target.value)}
                      className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl font-sans focus:outline-none focus:border-amber-800"
                    />
                  </div>
                </div>

                {inputType === "text" && (
                  <div>
                    <label className="block text-xs font-bold text-stone-700 uppercase tracking-widest mb-1">
                      正文粘贴区 *
                    </label>
                    <textarea
                      required
                      rows={6}
                      placeholder="在此粘贴该书、章节或文章的全文。AI 将智能切分段落语义，为每天适配恰当的阅读量。"
                      value={pastedText}
                      onChange={(e) => setPastedText(e.target.value)}
                      className="w-full px-4 py-3 bg-stone-50 border border-stone-200 rounded-xl font-sans focus:outline-none focus:border-amber-800 text-sm"
                    />
                  </div>
                )}

                {inputType === "url" && (
                  <div>
                    <label className="block text-xs font-bold text-stone-700 uppercase tracking-widest mb-1">
                      文章/读书网页链接 *
                    </label>
                    <input
                      type="url"
                      required
                      placeholder="请输入 https:// 开头的文章、电子书、散文或论文线上网址"
                      value={fileUrl}
                      onChange={(e) => setFileUrl(e.target.value)}
                      className="w-full px-4 py-2 bg-stone-50 border border-stone-200 rounded-xl font-sans focus:outline-none focus:border-amber-800"
                    />
                  </div>
                )}

                {inputType === "pdf" && (
                  <div className="border-2 border-dashed border-stone-200 p-6 rounded-xl text-center bg-stone-50 hover:bg-stone-100/50 transition-colors relative cursor-pointer">
                    <input
                      type="file"
                      accept=".pdf,.txt,.md,.text"
                      onChange={handleFileChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <Upload className="w-8 h-8 text-stone-400 mx-auto mb-2" />
                    <p className="text-sm font-medium text-stone-700">
                      {uploadedFileName ? `已选文件: ${uploadedFileName}` : "将 PDF / TXT / MD 文件拖拽至此，或点击本地上传"}
                    </p>
                    <p className="text-xs text-stone-400 mt-1">支持纯文本及 PDF 格式，AI 将从正文语义中为您进行自适应每日规划</p>
                  </div>
                )}
              </div>
            )}

            {/* Time input */}
            <div className="bg-stone-50/50 border border-stone-100 rounded-2xl p-4">
              <label className="block text-sm font-semibold text-stone-800 mb-2">
                2. 设定研读总天数（可选择或直接输入数值）
              </label>
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 mt-2">
                <input
                  type="range"
                  min="1"
                  max="30"
                  value={days}
                  onChange={(e) => setDays(Math.max(1, Number(e.target.value)))}
                  className="flex-1 h-2 bg-stone-200 rounded-lg appearance-none cursor-pointer accent-amber-800"
                />
                
                <div className="flex items-center justify-between sm:justify-start gap-2">
                  <div className="flex items-center border border-stone-200 rounded-xl overflow-hidden bg-white shadow-xs">
                    <button
                      type="button"
                      onClick={() => setDays(prev => Math.max(1, prev - 1))}
                      className="px-3 py-1.5 bg-stone-50 border-r border-stone-200 hover:bg-stone-100 text-stone-600 font-bold transition-colors text-sm"
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={days}
                      onChange={(e) => {
                        const val = Math.max(1, Number(e.target.value));
                        setDays(val);
                      }}
                      className="w-16 text-center font-serif font-bold text-stone-800 focus:outline-none focus:ring-1 focus:ring-amber-800 py-1 text-sm"
                    />
                    <span className="pr-3 text-xs font-semibold text-stone-400 font-sans select-none">天</span>
                    <button
                      type="button"
                      onClick={() => setDays(prev => prev + 1)}
                      className="px-3 py-1.5 bg-stone-50 border-l border-stone-200 hover:bg-stone-100 text-stone-600 font-bold transition-colors text-sm"
                    >
                      +
                    </button>
                  </div>
                  
                  <span className="text-sm font-serif font-bold text-amber-900 bg-amber-50 border border-amber-950/10 px-3 py-1 rounded-full">
                    当前: {days} 天计划
                  </span>
                </div>
              </div>
              <p className="text-xs text-stone-500 mt-2">
                推荐：一般短篇小说推荐 2-5 天；中长篇文章推荐 5-10 天；学术巨著、深度哲学著作推荐 10-30 天。
              </p>
            </div>

            {/* Submit btn */}
            <button
              type="submit"
              disabled={isLoading}
              className={`w-full flex items-center justify-center gap-2 py-4 px-6 rounded-xl font-serif text-lg font-bold text-white transition-all shadow-sm ${
                isLoading
                  ? "bg-stone-500 cursor-not-allowed"
                  : "bg-[#4a3f35] hover:bg-stone-900 active:scale-[0.99] hover:shadow-md"
              }`}
            >
              {isLoading ? (
                <>
                  <span className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                  <span>正在为您个性化切分与构思日程，请稍候...</span>
                </>
              ) : (
                <>
                  <BookOpen className="w-5 h-5" />
                  <span>启程 · 开启 AI 智绘共读舱</span>
                  <ChevronRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Right Side: Showcase info details */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-[#fcfbf7] border border-stone-200 rounded-2xl p-6 md:p-8 shadow-xs relative overflow-hidden">
            <h3 className="font-serif font-bold text-lg text-stone-900 mb-4 tracking-tight leading-snug">
              当下推荐：《{activePreset.title.split(" ")[0]}》
            </h3>
            <p className="font-serif text-stone-600 italic text-sm md:text-base leading-relaxed mb-6">
              “{activePreset.description}”
            </p>

            <div className="space-y-4 text-xs font-sans text-stone-600">
              <div className="flex items-start gap-2 border-t border-stone-150 pt-4">
                <div>
                  <strong className="text-stone-800 font-serif">今日文选摘录：</strong>
                  <span className="line-clamp-4 leading-relaxed italic block mt-1 text-stone-500">
                    {activePreset.fullTextExcerpt.slice(0, 240)}...
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {activePreset.tags.map((tag, idx) => (
                  <span key={idx} className="bg-stone-105 text-stone-600 border border-stone-200 px-2.5 py-0.5 rounded-full">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-xs">
            <h3 className="font-serif font-bold text-stone-800 text-base mb-4 pb-2 border-b border-stone-100">核心陪读学习机制</h3>
            <div className="space-y-4">
              <div className="flex gap-4">
                <div className="bg-stone-50 border border-stone-150 text-stone-600 font-serif text-sm font-bold w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0 select-none">
                  一
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-stone-800">苏格拉底导思维 (Socratic Hints)</h4>
                  <p className="text-xs text-stone-500 mt-1 leading-relaxed">
                    在阅读前，AI 为您划出应留心的特定意象或背景概念，让您翻开书本那一刹那就带着主动问题意识。
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="bg-stone-50 border border-stone-150 text-stone-600 font-serif text-sm font-bold w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0 select-none">
                  二
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-stone-800">读后主动回想 (Active Recall)</h4>
                  <p className="text-xs text-stone-500 mt-1 leading-relaxed">
                    摆脱应试测试。AI 精心裁制 3 个启发式主观思考题，促使您用自己语言重塑对章节义理的吸收。
                  </p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="bg-stone-50 border border-stone-150 text-stone-600 font-serif text-sm font-bold w-7 h-7 flex items-center justify-center rounded-lg flex-shrink-0 select-none">
                  三
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-stone-800">现代社会投影 (Society Mirror)</h4>
                  <p className="text-xs text-stone-500 mt-1 leading-relaxed">
                    打通时空壁垒。AI 主笔将书本智慧无缝映射到现代算法、消费迷局、精神内耗等社会现实命题中。
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
