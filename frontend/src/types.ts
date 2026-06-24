// ── 专题 ────────────────────────────────────────────────────────
export interface Skill {
  id: number;
  name: string;
  description: string;
  created_at: string;
  view_count?: number;
  chapters?: Chapter[];
}

// ── 大章节 ──────────────────────────────────────────────────────
export interface Chapter {
  id: number;
  title: string;
  order_num: number;
  sub_chapters: SubChapter[];
}

// ── 小章节 ──────────────────────────────────────────────────────
export interface SubChapter {
  id: number;
  title: string;
  order_num: number;
  chapter_id: number;
  chapter_title?: string;
  skill_name?: string;
  skill_id?: number;
  knowledge_points?: KnowledgePoint[];
  questions?: Question[];
  has_content?: boolean;
}

// ── 知识点 ──────────────────────────────────────────────────────
export interface KnowledgePoint {
  id: number;
  content: string;
  batch: number;
  created_at: string;
}

// ── 题目 ────────────────────────────────────────────────────────
export interface Question {
  id: number;
  type: 'single' | 'multi' | 'essay' | 'code';
  question: string;
  options: string[];
  correct_answer: string;
  explanation: string;
  batch: number;
  created_at: string;
}

// ── API 响应 ────────────────────────────────────────────────────
export interface SkillListResponse {
  skills: Skill[];
}

export interface AiChatResponse {
  answer: string;
}

// ── 做题状态 ────────────────────────────────────────────────────
export interface QuizAnswer {
  questionId: number;
  userAnswer: string;
  submitted: boolean;
  correct?: boolean;
}
