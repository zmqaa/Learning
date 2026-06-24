import { useState } from 'react';
import type { Skill } from '../types';
import ThemeToggle from './ThemeToggle';
import './Sidebar.css';

interface Props {
  skill: Skill;
  selectedSCId: number | null;
  onSelect: (scId: number) => void;
  onBack: () => void;
  isOpen?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ skill, selectedSCId, onSelect, onBack, isOpen, onClose }: Props) {
  const [collapsedChapters, setCollapsedChapters] = useState<Set<number>>(new Set());

  const toggleChapter = (chId: number) => {
    setCollapsedChapters((prev) => {
      const next = new Set(prev);
      if (next.has(chId)) {
        next.delete(chId);
      } else {
        next.add(chId);
      }
      return next;
    });
  };

  const scHasContent = (scId: number) => {
    if (!skill.chapters) return false;
    for (const ch of skill.chapters) {
      for (const sc of ch.sub_chapters) {
        if (sc.id === scId) return sc.has_content;
      }
    }
    return false;
  };

  return (
    <aside className={`sidebar ${isOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-header">
        <button className="sidebar-back" onClick={onBack}>
          ← 返回首页
        </button>
        <h2 className="sidebar-skill-name">{skill.name}</h2>
        {/* 移动端关闭按钮 */}
        <button className="sidebar-close-mobile" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="sidebar-theme-toggle">
        <ThemeToggle />
      </div>

      <nav className="sidebar-nav">
        {skill.chapters?.map((chapter) => {
          const isCollapsed = collapsedChapters.has(chapter.id);
          return (
            <div key={chapter.id} className="chapter-group">
              <button
                className="chapter-title"
                onClick={() => toggleChapter(chapter.id)}
              >
                <span className={`chapter-arrow ${isCollapsed ? '' : 'open'}`}>▶</span>
                <span>{chapter.title}</span>
              </button>

              {!isCollapsed && (
                <ul className="sub-chapter-list">
                  {chapter.sub_chapters?.map((sc) => (
                    <li
                      key={sc.id}
                      className={`sub-chapter-item ${
                        selectedSCId === sc.id ? 'active' : ''
                      }`}
                      onClick={() => onSelect(sc.id)}
                    >
                      <span className="sc-icon">
                        {scHasContent(sc.id) ? '●' : '○'}
                      </span>
                      <span className="sc-title">{sc.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
