# LearnLab

AI 驱动的备考学习工具。输入想学的技能/证书名称，AI 自动生成完整章节大纲、知识点总结和练习题。

## 项目结构

```
learning/
├── backend/                  # FastAPI 后端
│   ├── main.py               # API 入口，路由定义
│   ├── database.py           # SQLite 数据库初始化与连接
│   ├── ai_service.py         # AI 服务（调用 Anthropic 兼容 API）
│   ├── requirements.txt      # Python 依赖
│   ├── .env                  # API Key 和模型配置（不入 git）
│   └── learning.db           # SQLite 数据文件（不入 git）
├── frontend/                 # React 前端
│   ├── src/
│   │   ├── api.ts            # API 请求层（SSE 流式请求）
│   │   ├── types.ts          # TypeScript 类型定义
│   │   ├── theme.tsx          # 主题切换（亮/暗）
│   │   ├── pages/
│   │   │   ├── HomePage.tsx   # 首页 — 九宫格卡片 + 分页
│   │   │   └── SkillPage.tsx  # 技能详情 — 侧边栏 + 内容区
│   │   └── components/
│   │       ├── Sidebar.tsx        # 章节导航侧边栏
│   │       ├── SubChapterView.tsx # 知识点 + 练习题 + AI 生成
│   │       ├── Quiz.tsx           # 答题组件
│   │       ├── AIChat.tsx         # AI 答疑对话框
│   │       └── ThemeToggle.tsx    # 主题切换按钮
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
└── .gitignore
```

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 19 + TypeScript + Vite 8 |
| 路由 | react-router-dom v7 |
| Markdown | react-markdown + remark-gfm + remark-math + rehype-katex |
| 后端 | FastAPI + Uvicorn |
| 数据库 | SQLite（文件数据库，零配置） |
| AI | Anthropic 兼容 API（支持 DeepSeek 等） |
| 部署 | nginx 反代 + systemd 守护 + Let's Encrypt SSL |

## 本地开发

### 后端

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# 配置 .env
cp .env.example .env   # 然后填入 API Key

# 启动（端口 8000，hot reload）
python main.py
```

### 前端

```bash
cd frontend
npm install
npm run dev     # 端口 5173，代理 /api 到 localhost:8000
```

前端开发时 `api.ts` 中 `API_BASE` 为 `/api`，由 Vite 代理或 nginx 转发到后端。

## 生产部署

部署在 `learning.zmqaa.com`：

- **前端**：`npm run build` 构建到 `frontend/dist/`，nginx 直接提供静态文件
- **后端**：systemd 服务 `learning-backend` 守护，监听 `127.0.0.1:8000`
- **nginx**：HTTPS 终止 + `/api/` 反代到后端（SSE 需关闭 proxy_buffering）
- **SSL**：Let's Encrypt 自动续期

### 常用运维命令

```bash
sudo systemctl status learning-backend   # 查看后端状态
sudo systemctl restart learning-backend  # 重启后端
sudo nginx -t && sudo systemctl reload nginx  # 重载 nginx

# 前端更新
cd frontend && npm run build   # 构建后直接生效，无需重启
```

## 数据库

SQLite 单文件 `backend/learning.db`，含 5 张表：

- `skills` — 技能（如 "软考数据库工程师"）
- `chapters` — 大章节，关联 skill
- `sub_chapters` — 小章节，关联 chapter
- `knowledge_points` — 知识点，关联 sub_chapter，支持多批次
- `questions` — 题目（单选/多选/简答/代码），关联 sub_chapter

外键级联删除，删技能自动清理所有关联数据。

## API 概览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/skills` | 创建技能 + AI 生成章节 |
| GET | `/api/skills` | 列出所有技能 |
| GET | `/api/skills/:id` | 获取技能及章节树 |
| DELETE | `/api/skills/:id` | 删除技能 |
| GET | `/api/sub-chapters/:id` | 获取小章节（知识点+题目） |
| POST | `/api/sub-chapters/:id/generate-content` | AI 生成知识点和题目（非流式） |
| POST | `/api/sub-chapters/:id/generate-content-stream` | AI 生成内容（SSE 流式） |
| POST | `/api/sub-chapters/:id/generate-questions` | 增量生成更多题目 |
| POST | `/api/ai/chat` | AI 答疑（非流式） |
| POST | `/api/ai/chat-stream` | AI 答疑（SSE 流式） |
| POST | `/api/ai/judge-code` | AI 评判代码题 |

## 环境变量（backend/.env）

```bash
ANTHROPIC_API_KEY=sk-xxx           # 必填，API Key
ANTHROPIC_BASE_URL=https://api.anthropic.com  # 可选，默认 Anthropic 官方
ANTHROPIC_MODEL=claude-sonnet-4-6  # 可选，默认模型
```

兼容 Anthropic Messages API 的端点均可使用（DeepSeek、OpenRouter 等）。

## 前端设计要点

- **主题**：亮色暖米纸 / 暗色墨绿终端，跟随系统或手动切换，localStorage 持久化
- **SSE**：前端实现 SSE 行解析器，逐行 `data:` 前缀 + JSON 反序列化
- **分页**：首页九宫格每页 9 个，练习题区每页 3 道
- **响应式**：三列→两列→单列，侧边栏在移动端为抽屉式
