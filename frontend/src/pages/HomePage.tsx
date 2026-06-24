import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { listSkills, createSkill } from '../api';
import type { Skill } from '../types';
import './HomePage.css';

export default function HomePage() {
  const navigate = useNavigate();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [inputName, setInputName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const loadSkills = useCallback(async () => {
    try {
      const data = await listSkills();
      setSkills(data.skills || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

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

  return (
    <div className="home-page">
      <div className="home-container">
        <header className="home-header">
          <h1>学习助手</h1>
          <p className="home-subtitle">
            AI 驱动的备考学习工具 — 选择你想学的技能，自动生成章节和练习题
          </p>
        </header>

        {/* 创建新技能 */}
        <div className="create-section">
          <div className="create-input-group">
            <input
              type="text"
              placeholder="输入证书或技能名称，如：软考数据库工程师、Python数据分析..."
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
                  <span className="spinner" /> AI正在生成章节...
                </>
              ) : (
                '开始学习'
              )}
            </button>
          </div>
          {error && <p className="error-msg">{error}</p>}
        </div>

        {/* 已有技能列表 */}
        <div className="skills-section">
          <h2>我的学习</h2>
          {loading ? (
            <div className="loading-wrap">
              <span className="spinner" />
            </div>
          ) : skills.length === 0 ? (
            <div className="empty-state">
              <p>还没有开始学习任何技能</p>
              <p className="hint">在上方输入想学的内容，AI 会帮你生成学习大纲</p>
            </div>
          ) : (
            <div className="skills-grid">
              {skills.map((skill) => (
                <div
                  key={skill.id}
                  className="skill-card"
                  onClick={() => navigate(`/skill/${skill.id}`)}
                >
                  <div className="skill-card-body">
                    <h3>{skill.name}</h3>
                    <p>{skill.description}</p>
                    <span className="skill-date">
                      {new Date(skill.created_at).toLocaleDateString('zh-CN')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
