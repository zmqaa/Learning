import { useTheme } from '../theme';
import './ThemeToggle.css';

export default function ThemeToggle() {
  const { theme, toggle } = useTheme();

  return (
    <div
      className="theme-toggle"
      onClick={toggle}
      title={`当前：${theme === 'dark' ? '深色模式' : '浅色模式'} — 点击切换`}
    >
      <span className={`theme-indicator ${theme}`} />
      <span className="theme-label">{theme === 'dark' ? '深色' : '浅色'}</span>
    </div>
  );
}
