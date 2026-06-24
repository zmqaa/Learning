import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSkill } from '../api';
import Sidebar from '../components/Sidebar';
import SubChapterView from '../components/SubChapterView';
import type { Skill } from '../types';
import './SkillPage.css';

export default function SkillPage() {
  const { skillId } = useParams<{ skillId: string }>();
  const navigate = useNavigate();
  const [skill, setSkill] = useState<Skill | null>(null);
  const [selectedSCId, setSelectedSCId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadSkill = useCallback(async () => {
    if (!skillId) return;
    setLoading(true);
    try {
      const data = await getSkill(Number(skillId));
      setSkill(data);
      if (data.chapters?.length > 0) {
        const firstSC = data.chapters[0].sub_chapters?.[0];
        if (firstSC) {
          setSelectedSCId(firstSC.id);
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [skillId]);

  useEffect(() => {
    loadSkill();
  }, [loadSkill]);

  // 切换子章节时关闭侧边栏（移动端）
  const handleSelectSubChapter = (scId: number) => {
    setSelectedSCId(scId);
    setSidebarOpen(false);
  };

  const handleContentUpdated = () => {
    loadSkill();
  };

  if (loading) {
    return (
      <div className="skill-page-loading">
        <span className="spinner" />
        <p>加载中...</p>
      </div>
    );
  }

  if (error || !skill) {
    return (
      <div className="skill-page-loading">
        <p className="error-msg">{error || '技能不存在'}</p>
        <button className="btn btn-outline" onClick={() => navigate('/')}>
          返回首页
        </button>
      </div>
    );
  }

  return (
    <div className="skill-page">
      {/* 移动端遮罩 */}
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}

      <Sidebar
        skill={skill}
        selectedSCId={selectedSCId}
        onSelect={handleSelectSubChapter}
        onBack={() => navigate('/')}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="skill-content">
        {/* 移动端顶栏 */}
        <div className="mobile-topbar">
          <button className="hamburger-btn" onClick={() => setSidebarOpen(true)}>
            ☰
          </button>
          <span className="mobile-skill-name">{skill.name}</span>
        </div>

        {selectedSCId ? (
          <SubChapterView
            subChapterId={selectedSCId}
            onContentUpdated={handleContentUpdated}
          />
        ) : (
          <div className="skill-welcome">
            <h2>{skill.name}</h2>
            <p>{skill.description}</p>
            <p className="hint">从左侧选择一个章节开始学习</p>
          </div>
        )}
      </main>
    </div>
  );
}
