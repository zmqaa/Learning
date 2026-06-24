import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { listSkills, createSkill } from '../api';
import type { Skill } from '../types';
import './HomePage.css';

const PAGE_SIZE = 9; // 3x3 grid

export default function HomePage() {
  const navigate = useNavigate();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputName, setInputName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [topSkills, setTopSkills] = useState<Skill[]>([]);

  const loadSkills = useCallback(async () => {
    try {
      const data = await listSkills(search || undefined);
      setSkills(data.skills || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [search]);

  const loadTopSkills = useCallback(async () => {
    try {
      const data = await listSkills(undefined, 'views');
      setTopSkills((data.skills || []).slice(0, 10));
    } catch {
      // silently fail for ranking
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    loadTopSkills();
  }, [loadTopSkills]);

  const handleCreate = async () => {
    const name = inputName.trim();
    if (!name) return;
    setCreating(true);
    setError('');
    try {
      const skill = await createSkill(name);
      setSkills((prev) => [skill, ...prev]);
      setInputName('');
      navigate(`/skill/${skill.id}`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const handleCardClick = (skill: Skill) => {
    navigate(`/skill/${skill.id}`);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      setPage(1);
      setLoading(true);
      loadSkills();
    }
  };

  // -- pagination --
  const totalPages = Math.max(1, Math.ceil(skills.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const pageSkills = skills.slice(startIdx, startIdx + PAGE_SIZE);

  const goToPage = (p: number) => {
    setPage(Math.max(1, Math.min(p, totalPages)));
  };

  const renderPageButtons = () => {
    const buttons: number[] = [];
    const maxShow = 5;
    let start = Math.max(1, safePage - Math.floor(maxShow / 2));
    let end = Math.min(totalPages, start + maxShow - 1);
    if (end - start + 1 < maxShow) {
      start = Math.max(1, end - maxShow + 1);
    }
    for (let i = start; i <= end; i++) {
      buttons.push(i);
    }
    return buttons;
  };

  return (
    <div className="home-page">
      <div className="home-layout">
        {/* -- main content -- */}
        <div className="home-main">
          <div className="home-container">
            <header className="home-header">
              <h1>LearnLab</h1>
              <p className="home-subtitle">
                选择你想学的专题，AI 自动生成章节大纲和练习题
              </p>
            </header>

            {/* create */}
            <div className="create-section">
              <div className="create-input-group">
                <input
                  type="text"
                  placeholder="输入证书、专题名称或任何想学的内容..."
                  value={inputName}
                  onChange={(e) => setInputName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                />
                <button
                  className="btn btn-primary"
                  onClick={handleCreate}
                  disabled={creating || !inputName.trim()}
                >
                  {creating ? (
                    <>
                      <span className="spinner" /> AI 正在生成章节...
                    </>
                  ) : (
                    '开始学习'
                  )}
                </button>
              </div>
              {error && <p className="error-msg">{error}</p>}
            </div>

            {/* search */}
            <div className="search-section">
              <input
                type="text"
                className="search-input"
                placeholder="搜索已有专题..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
            </div>

            {/* topic list */}
            <div className="skills-section">
              <h2>我的专题</h2>
              {loading ? (
                <div className="loading-wrap">
                  <span className="spinner" />
                </div>
              ) : skills.length === 0 ? (
                <div className="empty-state">
                  <p>{search ? '没有匹配的专题' : '还没有开始学习任何专题'}</p>
                  <p className="hint">
                    {search
                      ? '试试其他关键词'
                      : '在上方输入想学的内容，AI 会帮你生成学习大纲'}
                  </p>
                </div>
              ) : (
                <>
                  <div className="skills-grid">
                    {pageSkills.map((skill) => (
                      <div
                        key={skill.id}
                        className="skill-card"
                        onClick={() => handleCardClick(skill)}
                      >
                        <h3 className="skill-card-title">{skill.name}</h3>
                      </div>
                    ))}
                  </div>

                  {totalPages > 1 && (
                    <div className="pagination">
                      <button
                        className="btn btn-page"
                        onClick={() => goToPage(safePage - 1)}
                        disabled={safePage <= 1}
                      >
                        &larr; 上一页
                      </button>

                      {renderPageButtons().map((p) => (
                        <button
                          key={p}
                          className={`btn btn-page-num ${p === safePage ? 'active' : ''}`}
                          onClick={() => goToPage(p)}
                        >
                          {p}
                        </button>
                      ))}

                      <button
                        className="btn btn-page"
                        onClick={() => goToPage(safePage + 1)}
                        disabled={safePage >= totalPages}
                      >
                        下一页 &rarr;
                      </button>
                    </div>
                  )}

                  <div className="page-info-text">
                    共 {skills.length} 个专题，第 {safePage}/{totalPages} 页
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* -- right sidebar: ranking -- */}
        <aside className="home-sidebar">
          <div className="ranking-panel">
            <h3 className="ranking-title">热门专题</h3>
            {topSkills.length === 0 ? (
              <p className="ranking-empty">暂无数据</p>
            ) : (
              <ol className="ranking-list">
                {topSkills.map((skill, idx) => (
                  <li
                    key={skill.id}
                    className={`ranking-item ${idx < 3 ? 'top-' + (idx + 1) : ''}`}
                    onClick={() => handleCardClick(skill)}
                  >
                    <span className="ranking-num">{idx + 1}</span>
                    <span className="ranking-name">{skill.name}</span>
                    <span className="ranking-count">{skill.view_count || 0}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
