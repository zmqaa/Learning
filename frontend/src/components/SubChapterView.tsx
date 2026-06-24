import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { getSubChapter, generateContentStream, generateMoreQuestions } from '../api';
import Quiz from './Quiz';
import type { SubChapter } from '../types';
import './SubChapterView.css';

const QUESTIONS_PER_PAGE = 3;

interface Props {
  subChapterId: number;
  onContentUpdated: () => void;
}

export default function SubChapterView({ subChapterId, onContentUpdated }: Props) {
  const [data, setData] = useState<SubChapter | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [genMore, setGenMore] = useState(false);
  const [error, setError] = useState('');
  const [showKP, setShowKP] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await getSubChapter(subChapterId);
      setData(result);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [subChapterId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 切换子章节时重置页码
  useEffect(() => {
    setCurrentPage(1);
  }, [subChapterId]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError('');
    setStreamingText('');

    try {
      await generateContentStream(subChapterId, {
        onChunk: (text) => {
          setStreamingText((prev) => prev + text);
        },
        onDone: async () => {
          setStreamingText('');
          setGenerating(false);
          await loadData();
          onContentUpdated();
        },
        onError: (msg) => {
          setError(msg);
          setGenerating(false);
        },
      });
    } catch (e: any) {
      setError(e.message);
      setGenerating(false);
    }
  };

  const handleGenerateMore = async () => {
    setGenMore(true);
    setError('');
    try {
      await generateMoreQuestions(subChapterId);
      await loadData();
      // 生成新题目后跳到最后一页
      // 延迟一下等 data 更新后再算页码
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGenMore(false);
    }
  };

  // 生成更多题目后自动跳到新题所在页
  useEffect(() => {
    if (data?.questions) {
      const totalPages = Math.ceil(data.questions.length / QUESTIONS_PER_PAGE);
      if (currentPage > totalPages) {
        setCurrentPage(Math.max(totalPages, 1));
      }
    }
  }, [data?.questions, currentPage]);

  if (loading) {
    return (
      <div className="sc-loading">
        <span className="spinner" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="sc-error">
        <p>{error}</p>
        <button className="btn btn-outline" onClick={loadData}>重试</button>
      </div>
    );
  }

  if (!data) return null;

  // ── 无内容：居中显示生成按钮 ──────────────────────────
  if (!data.has_content) {
    return (
      <div className="sub-chapter-view">
        <div className="sc-breadcrumb">
          <span>{data.skill_name}</span>
          <span className="sep">/</span>
          <span>{data.chapter_title}</span>
          <span className="sep">/</span>
          <span className="current">{data.title}</span>
        </div>

        <div className="sc-empty">
          <div className="sc-empty-icon">○</div>
          <h3>这个章节还没有内容</h3>
          <p>AI 将为你生成知识点摘要和 5 道练习题</p>
          <button
            className="btn btn-primary"
            onClick={handleGenerate}
            disabled={generating}
          >
            {generating ? (
              <>
                <span className="spinner" /> AI 正在生成...
              </>
            ) : (
              'AI 生成内容'
            )}
          </button>

          {generating && streamingText && (
            <div className="sc-streaming">
              <h3>AI 正在生成内容...</h3>
              <div className="sc-streaming-content">{streamingText}</div>
            </div>
          )}

          {error && <p className="sc-error-msg">{error}</p>}
        </div>
      </div>
    );
  }

  // ── 有内容：左右分栏 ──────────────────────────────────
  const kp = data.knowledge_points?.[0];
  const allQuestions = data.questions || [];
  const totalPages = Math.ceil(allQuestions.length / QUESTIONS_PER_PAGE);

  // 每页显示5道题
  const startIdx = (currentPage - 1) * QUESTIONS_PER_PAGE;
  const pageQuestions = allQuestions.slice(startIdx, startIdx + QUESTIONS_PER_PAGE);

  const goToPage = (p: number) => {
    setCurrentPage(Math.max(1, Math.min(p, totalPages)));
  };

  return (
    <div className="sub-chapter-view">
      {/* 面包屑 */}
      <div className="sc-breadcrumb">
        <span>{data.skill_name}</span>
        <span className="sep">/</span>
        <span>{data.chapter_title}</span>
        <span className="sep">/</span>
        <span className="current">{data.title}</span>
      </div>

      <div className="sc-layout">
        {/* ── 左侧：知识点 ──────────────────────────────── */}
        <aside className="sc-left">
          {kp && (
            <div className="sc-kp-section">
              <div className="sc-section-header">
                <h3
                  className={`sc-section-toggle ${showKP ? '' : 'collapsed'}`}
                  onClick={() => setShowKP(!showKP)}
                >
                  知识点
                  <span className="toggle-arrow">{showKP ? '▼' : '▶'}</span>
                </h3>
              </div>
              {showKP && (
                <div className="sc-kp-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {kp.content}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          )}
        </aside>

        {/* ── 右侧：题目 + 分页 ──────────────────────────── */}
        <section className="sc-right">
          <h3 className="sc-right-title">练习题</h3>

          {/* 当前页题目 */}
          {pageQuestions.length > 0 ? (
            <Quiz questions={pageQuestions} />
          ) : (
            <p className="sc-no-questions">暂无题目</p>
          )}

          {/* 分页控件 */}
          {totalPages > 1 && (
            <div className="sc-pagination">
              <button
                className="btn btn-page"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage <= 1}
              >
                ← 上一页
              </button>

              <span className="page-info">
                {currentPage} / {totalPages}
              </span>

              <button
                className="btn btn-page"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= totalPages}
              >
                下一页 →
              </button>
            </div>
          )}

          {/* 生成更多题目 */}
          <div className="sc-more-section">
            <button
              className="btn btn-outline"
              onClick={handleGenerateMore}
              disabled={genMore}
            >
              {genMore ? (
                <>
                  <span className="spinner" /> 生成中...
                </>
              ) : (
                '再生成5道题'
              )}
            </button>
            <span className="gen-hint">让 AI 出更多题目来巩固知识</span>
          </div>
        </section>
      </div>

      {error && <p className="sc-error-msg">{error}</p>}
    </div>
  );
}
