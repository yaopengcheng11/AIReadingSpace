export interface ChatMessage {
  role: "user" | "model";
  parts: string;
}

export interface StoryAnalysis {
  storyName: string;
  background: string;       // 时代大环境
  psychology: string;       // 人物心理剖析
  socialStatus: string;     // 社会地位地位
  socialRelations: string;  // 复杂社会关系
  essence: string;          // 核心义理与醍醐灌顶
}

export interface ReadingDay {
  day: number;
  title: string;
  excerpt: string; // The book content part for this day
  summary: string;
  hints: string[];
  questions: string[];
  reflection: string;
  outlook: string;
  wordCount: number;
  storyAnalyses?: StoryAnalysis[];
  modernParaphrase?: string[]; // paragraph-by-paragraph modern context/interpretation
  expertAnnotations?: string[]; // paragraph-by-paragraph expert insights & metaphors
}

export interface BookJourney {
  id: string;
  title: string;
  author: string;
  totalDays: number;
  schedule: ReadingDay[];
  userAnswers: { [day: number]: string[] }; // user answers to the 3 daily active recall questions
  userNotes: { [day: number]: string }; // user notes for each day
  userParagraphAnnotations?: { [day: number]: { [paragraphIndex: number]: string } }; // custom reader paragraph annotations
  chatHistories: { [day: number]: ChatMessage[] }; // active recall & chat conversations
  currentDay: number;
}

export interface StartJourneyRequest {
  title: string;
  author?: string;
  days: number;
  inputType: "preset" | "text" | "url" | "pdf";
  presetId?: string;
  content?: string; // Pasted plain text or raw text parsed from file
  fileUrl?: string; // Passed web URL
  pdfBase64?: string; // Base64 representation of uploaded PDF
}
