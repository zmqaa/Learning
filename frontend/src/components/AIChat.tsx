import { useState, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { chatAboutQuestionStream } from '../api';
import type { Question } from '../types';
import './AIChat.css';

interface Props {
  question: Question;
  onClose: () => void;
}

export default function AIChat({ question, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<{ role: 'user' | 'ai'; content: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const streamContentRef = useRef('');

  const handleSend = async () => {
    const q = query.trim();
    if (!q) return;

    setMessages((prev) => [...prev, { role: 'user', content: q }]);
    setQuery('');
    setLoading(true);
    streamContentRef.current = '';
    // 先添加一条空的 AI 消息占位
    setMessages((prev) => [...prev, { role: 'ai', content: '' }]);

    try {
      await chatAboutQuestionStream(question.id, q, {
        onChunk: (text) => {
          streamContentRef.current += text;
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'ai', content: streamContentRef.current };
            return updated;
          });
        },
        onDone: () => {
          setLoading(false);
        },
        onError: (msg) => {
          setMessages((prev) => {
            const updated = [...prev];
            updated[updated.length - 1] = { role: 'ai', content: `[错误] 出错了：${msg}` };
            return updated;
          });
          setLoading(false);
        },
      });
    } catch (e: any) {
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'ai', content: `[错误] 出错了：${e.message}` };
        return updated;
      });
      setLoading(false);
    }
  };

  return (
    <div className="ai-chat">
      <div className="ai-chat-header">
        <span>AI 答疑</span>
        <button className="ai-chat-close" onClick={onClose}>
          ×
        </button>
      </div>

      {messages.length > 0 && (
        <div className="ai-chat-messages">
          {messages.map((msg, i) => (
            <div key={i} className={`ai-msg ai-msg-${msg.role}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{msg.content}</ReactMarkdown>
              {loading && i === messages.length - 1 && msg.role === 'ai' && !msg.content && (
                <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="ai-chat-input">
        <input
          type="text"
          placeholder="问 AI 这道题为什么是这个答案..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={handleSend}
          disabled={loading || !query.trim()}
        >
          发送
        </button>
      </div>
    </div>
  );
}
