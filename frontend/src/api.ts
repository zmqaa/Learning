const API_BASE = '/api';

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── SSE 流式请求 ──────────────────────────────────────────────────

interface SSEEvent {
  type: 'chunk' | 'done' | 'error';
  content?: string;
  message?: string;
}

export async function fetchSSE(
  url: string,
  body: any,
  callbacks: {
    onChunk?: (text: string) => void;
    onDone?: () => void;
    onError?: (message: string) => void;
  }
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    callbacks.onError?.(err.detail || `HTTP ${res.status}`);
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    callbacks.onError?.('无法读取响应流');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // 最后一个可能不完整，保留在 buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data: SSEEvent = JSON.parse(line.slice(6));
          if (data.type === 'chunk' && data.content) {
            callbacks.onChunk?.(data.content);
          } else if (data.type === 'done') {
            callbacks.onDone?.();
          } else if (data.type === 'error') {
            callbacks.onError?.(data.message || '未知错误');
            return;
          }
        } catch {
          // 跳过无法解析的行
        }
      }
    }

    // 处理 buffer 中剩余的数据
    if (buffer.startsWith('data: ')) {
      try {
        const data: SSEEvent = JSON.parse(buffer.slice(6));
        if (data.type === 'done') callbacks.onDone?.();
        else if (data.type === 'error') callbacks.onError?.(data.message || '未知错误');
      } catch { /* ignore */ }
    }
  } catch (e: any) {
    callbacks.onError?.(e.message || '流读取失败');
  }
}

// ── 专题 ────────────────────────────────────────────────────────
export async function listSkills(search?: string, sort?: string) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (sort) params.set('sort', sort);
  const qs = params.toString();
  return fetchJSON<{ skills: any[] }>(`${API_BASE}/skills${qs ? '?' + qs : ''}`);
}

export async function getSkill(id: number) {
  return fetchJSON<any>(`${API_BASE}/skills/${id}`);
}

export async function createSkill(name: string, description?: string) {
  return fetchJSON<any>(`${API_BASE}/skills`, {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
}

export async function deleteSkill(id: number) {
  return fetchJSON<any>(`${API_BASE}/skills/${id}`, { method: 'DELETE' });
}

export async function incrementViewCount(id: number) {
  return fetchJSON<any>(`${API_BASE}/skills/${id}/view`, { method: 'POST' });
}

// ── 小章节 ──────────────────────────────────────────────────────
export async function getSubChapter(id: number) {
  return fetchJSON<any>(`${API_BASE}/sub-chapters/${id}`);
}

export async function generateContent(subChapterId: number) {
  return fetchJSON<any>(`${API_BASE}/sub-chapters/${subChapterId}/generate-content`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function generateContentStream(
  subChapterId: number,
  callbacks: {
    onChunk?: (text: string) => void;
    onDone?: () => void;
    onError?: (message: string) => void;
  }
): Promise<void> {
  return fetchSSE(
    `${API_BASE}/sub-chapters/${subChapterId}/generate-content-stream`,
    {},
    callbacks
  );
}

export async function generateMoreQuestions(subChapterId: number, count = 5) {
  return fetchJSON<any>(`${API_BASE}/sub-chapters/${subChapterId}/generate-questions`, {
    method: 'POST',
    body: JSON.stringify({ count }),
  });
}

// ── 代码题 AI 评判 ──────────────────────────────────────────────

export async function judgeCodeAnswer(questionId: number, userCode: string) {
  return fetchJSON<{ correct: boolean; feedback: string }>(`${API_BASE}/ai/judge-code`, {
    method: 'POST',
    body: JSON.stringify({ question_id: questionId, user_code: userCode }),
  });
}

// ── AI 答疑 ─────────────────────────────────────────────────────
export async function chatAboutQuestion(questionId: number, query: string) {
  return fetchJSON<{ answer: string }>(`${API_BASE}/ai/chat`, {
    method: 'POST',
    body: JSON.stringify({ question_id: questionId, query }),
  });
}

export function chatAboutQuestionStream(
  questionId: number,
  query: string,
  callbacks: {
    onChunk?: (text: string) => void;
    onDone?: () => void;
    onError?: (message: string) => void;
  }
): Promise<void> {
  return fetchSSE(
    `${API_BASE}/ai/chat-stream`,
    { question_id: questionId, query },
    callbacks
  );
}
