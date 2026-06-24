import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import AIChat from './AIChat';
import { judgeCodeAnswer } from '../api';
import type { Question } from '../types';
import './Quiz.css';

const STORAGE_KEY = 'quiz_state';

interface StoredState {
  answers: Record<number, string>;
  submitted: Record<number, boolean>;
  codeResult: Record<number, { correct: boolean; feedback: string } | null>;
}

interface Props {
  questions: Question[];
}

function loadState(): StoredState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { answers: {}, submitted: {}, codeResult: {} };
  } catch {
    return { answers: {}, submitted: {}, codeResult: {} };
  }
}

function saveState(state: StoredState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* ignore quota errors */ }
}

export default function Quiz({ questions }: Props) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState<Record<number, boolean>>({});
  const [selectedChatQ, setSelectedChatQ] = useState<number | null>(null);
  const [codeJudging, setCodeJudging] = useState<Record<number, boolean>>({});
  const [codeResult, setCodeResult] = useState<Record<number, { correct: boolean; feedback: string } | null>>({});
  const [restored, setRestored] = useState(false);

  // 从 localStorage 恢复状态
  useEffect(() => {
    const saved = loadState();
    const qIds = new Set(questions.map((q) => q.id));

    // 只恢复属于当前页题目的状态
    const filteredAnswers: Record<number, string> = {};
    const filteredSubmitted: Record<number, boolean> = {};
    const filteredCodeResult: Record<number, { correct: boolean; feedback: string } | null> = {};

    for (const [idStr, answer] of Object.entries(saved.answers)) {
      const id = Number(idStr);
      if (qIds.has(id)) filteredAnswers[id] = answer;
    }
    for (const [idStr, sub] of Object.entries(saved.submitted)) {
      const id = Number(idStr);
      if (qIds.has(id)) filteredSubmitted[id] = sub;
    }
    for (const [idStr, cr] of Object.entries(saved.codeResult)) {
      const id = Number(idStr);
      if (qIds.has(id) && cr) filteredCodeResult[id] = cr as { correct: boolean; feedback: string };
    }

    setAnswers(filteredAnswers);
    setSubmitted(filteredSubmitted);
    setCodeResult(filteredCodeResult);
    setRestored(true);
  }, [questions]);

  // 状态变化时持久化（仅在恢复完成后）
  useEffect(() => {
    if (!restored) return;
    saveState({ answers, submitted, codeResult });
  }, [answers, submitted, codeResult, restored]);

  const handleSelect = (qId: number, value: string) => {
    if (submitted[qId]) return;
    setAnswers((prev) => ({ ...prev, [qId]: value }));
  };

  const handleSubmit = (qId: number) => {
    if (!answers[qId]) return;
    setSubmitted((prev) => ({ ...prev, [qId]: true }));
  };

  const handleReset = (qId: number) => {
    setAnswers((prev) => {
      const next = { ...prev };
      delete next[qId];
      return next;
    });
    setSubmitted((prev) => {
      const next = { ...prev };
      delete next[qId];
      return next;
    });
    setCodeResult((prev) => {
      const next = { ...prev };
      delete next[qId];
      return next;
    });
    setSelectedChatQ(null);
  };

  const handleCodeJudge = async (qId: number) => {
    const code = answers[qId];
    if (!code) return;
    setCodeJudging((prev) => ({ ...prev, [qId]: true }));
    setCodeResult((prev) => ({ ...prev, [qId]: null }));
    try {
      const result = await judgeCodeAnswer(qId, code);
      setCodeResult((prev) => ({ ...prev, [qId]: result }));
      setSubmitted((prev) => ({ ...prev, [qId]: true }));
    } catch (e: any) {
      setCodeResult((prev) => ({ ...prev, [qId]: { correct: false, feedback: `评判出错：${e.message}` } }));
      setSubmitted((prev) => ({ ...prev, [qId]: true }));
    } finally {
      setCodeJudging((prev) => ({ ...prev, [qId]: false }));
    }
  };

  const isCorrect = (q: Question, userAnswer: string) => {
    return userAnswer.trim().toUpperCase() === q.correct_answer.trim().toUpperCase();
  };

  const getOptionLabel = (opt: string) => {
    const match = opt.match(/^([A-E])[.、)\s]/);
    return match ? match[1] : opt[0];
  };

  return (
    <div className="quiz">
      {questions.map((q, idx) => {
        const qSubmitted = submitted[q.id];
        const qAnswer = answers[q.id] || '';
        const correct = q.type === 'code'
          ? (codeResult[q.id]?.correct ?? null)
          : qSubmitted ? isCorrect(q, qAnswer) : null;
        const judging = codeJudging[q.id] || false;

        return (
          <div key={q.id} className={`quiz-card ${qSubmitted ? (correct ? 'correct' : 'wrong') : ''}`}>
            <div className="quiz-header">
              <span className={`quiz-type-badge type-${q.type}`}>
                {q.type === 'single' ? '单选' : q.type === 'multi' ? '多选' : q.type === 'code' ? '实操' : '简答'}
              </span>
              <span className="quiz-number">第 {idx + 1} 题</span>
            </div>

            <div className="quiz-question">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{q.question}</ReactMarkdown>
            </div>

            {/* 选择题选项 */}
            {(q.type === 'single' || q.type === 'multi') && q.options?.length > 0 && (
              <div className="quiz-options">
                {q.options.map((opt, oi) => {
                  const label = getOptionLabel(opt);
                  const selected = q.type === 'multi'
                    ? qAnswer.includes(label)
                    : qAnswer === label;
                  const isCorrectOpt = q.correct_answer.includes(label);

                  let optClass = '';
                  if (qSubmitted) {
                    if (isCorrectOpt) optClass = 'opt-correct';
                    else if (selected && !isCorrectOpt) optClass = 'opt-wrong';
                  } else if (selected) {
                    optClass = 'opt-selected';
                  }

                  return (
                    <button
                      key={oi}
                      className={`quiz-option ${optClass}`}
                      onClick={() => {
                        if (q.type === 'multi') {
                          const current = qAnswer.split('').filter(Boolean);
                          const i = current.indexOf(label);
                          if (i >= 0) {
                            current.splice(i, 1);
                          } else {
                            current.push(label);
                          }
                          handleSelect(q.id, current.sort().join(''));
                        } else {
                          handleSelect(q.id, label);
                        }
                      }}
                      disabled={qSubmitted}
                    >
                      <span className="opt-label">{label}</span>
                      <span className="opt-text">{opt.replace(/^[A-E][.、)\s]+/, '')}</span>
                      {qSubmitted && isCorrectOpt && <span className="opt-icon">✓</span>}
                      {qSubmitted && selected && !isCorrectOpt && <span className="opt-icon">✗</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {/* 简答题输入 */}
            {q.type === 'essay' && (
              <div className="quiz-essay">
                <textarea
                  rows={4}
                  placeholder="请输入你的答案..."
                  value={qAnswer}
                  onChange={(e) => handleSelect(q.id, e.target.value)}
                  disabled={qSubmitted}
                />
              </div>
            )}

            {/* 代码题输入 */}
            {q.type === 'code' && (
              <div className="quiz-code">
                <textarea
                  rows={8}
                  placeholder="请在此输入你的代码..."
                  value={qAnswer}
                  onChange={(e) => handleSelect(q.id, e.target.value)}
                  disabled={qSubmitted}
                  spellCheck={false}
                />
              </div>
            )}

            {/* 操作按钮 */}
            <div className="quiz-actions">
              {!qSubmitted ? (
                q.type === 'code' ? (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handleCodeJudge(q.id)}
                    disabled={judging || !qAnswer}
                  >
                    {judging ? (
                      <>
                        <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> AI 评判中...
                      </>
                    ) : (
                      '提交评判'
                    )}
                  </button>
                ) : (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => handleSubmit(q.id)}
                    disabled={!qAnswer}
                  >
                    提交答案
                  </button>
                )
              ) : (
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => handleReset(q.id)}
                >
                  重新作答
                </button>
              )}
            </div>

            {/* 提交后的解析 */}
            {qSubmitted && (
              <div className={`quiz-explanation ${correct ? 'exp-correct' : 'exp-wrong'}`}>
                {q.type === 'code' ? (
                  <>
                    <div className="exp-result">
                      {judging ? '评判中...' : correct ? '[正确] 回答正确！' : '[错误] 需要改进'}
                    </div>
                    {codeResult[q.id] && (
                      <div className="exp-detail">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                          {codeResult[q.id]!.feedback}
                        </ReactMarkdown>
                      </div>
                    )}
                    <details className="exp-reference">
                      <summary>查看参考答案</summary>
                      <pre><code>{q.correct_answer}</code></pre>
                    </details>
                  </>
                ) : (
                  <>
                    <div className="exp-result">
                      {correct ? '[正确] 回答正确！' : '[错误] 回答错误'}
                      {q.type === 'essay' && (
                        <span className="exp-ref">（参考答案如下，请自行对照）</span>
                      )}
                    </div>
                    {q.type !== 'essay' && (
                      <div className="exp-answer">
                        正确答案：<strong>{q.correct_answer}</strong>
                      </div>
                    )}
                    <div className="exp-detail">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{q.explanation}</ReactMarkdown>
                    </div>
                  </>
                )}

                {/* AI 答疑入口 */}
                <div className="exp-ai-chat">
                  {selectedChatQ === q.id ? (
                    <AIChat
                      question={q}
                      onClose={() => setSelectedChatQ(null)}
                    />
                  ) : (
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => setSelectedChatQ(q.id)}
                    >
                      问 AI 这道题
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
