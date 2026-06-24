import json
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional

from database import get_db, init_db
from ai_service import (
    generate_chapters,
    generate_content,
    generate_content_stream,
    generate_more_questions,
    chat_about_question,
    chat_about_question_stream,
    judge_code_answer,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="LearnLab API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "https://learning.zmqaa.com", "http://learning.zmqaa.com"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic Models ──────────────────────────────────────────────

class CreateSkillRequest(BaseModel):
    name: str
    description: str = ""


class GenerateContentRequest(BaseModel):
    skill_name: str = ""
    chapter_title: str = ""
    sub_chapter_title: str = ""


class GenerateMoreRequest(BaseModel):
    skill_name: str = ""
    chapter_title: str = ""
    sub_chapter_title: str = ""
    count: int = 5


class ChatRequest(BaseModel):
    question_id: int
    query: str


class JudgeCodeRequest(BaseModel):
    question_id: int
    user_code: str


# ── Helper ────────────────────────────────────────────────────────

def row_to_dict(row) -> dict:
    if row is None:
        return {}
    return dict(row)


# ── Skills ────────────────────────────────────────────────────────

@app.post("/api/skills")
def create_skill(req: CreateSkillRequest):
    """创建新技能 + AI生成章节结构"""
    # 1. 调用AI生成章节
    try:
        chapter_data = generate_chapters(req.name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI生成章节失败: {str(e)}")

    conn = get_db()
    try:
        # 2. 插入技能
        cursor = conn.execute(
            "INSERT INTO skills (name, description) VALUES (?, ?)",
            (req.name, req.description or f"备考 {req.name} 的学习资料"),
        )
        skill_id = cursor.lastrowid

        # 3. 插入章节
        for i, ch in enumerate(chapter_data.get("chapters", [])):
            cursor = conn.execute(
                "INSERT INTO chapters (skill_id, title, order_num) VALUES (?, ?, ?)",
                (skill_id, ch["title"], i + 1),
            )
            chapter_id = cursor.lastrowid

            for j, sub_title in enumerate(ch.get("sub_chapters", [])):
                conn.execute(
                    "INSERT INTO sub_chapters (chapter_id, title, order_num) VALUES (?, ?, ?)",
                    (chapter_id, sub_title, j + 1),
                )

        conn.commit()

        # 4. 返回完整技能数据
        return get_skill(skill_id)
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"保存失败: {str(e)}")
    finally:
        conn.close()


@app.get("/api/skills")
def list_skills(search: str = "", sort: str = "created"):
    """获取所有专题列表，支持搜索和排序"""
    conn = get_db()
    try:
        query = "SELECT id, name, description, created_at, view_count FROM skills"
        params = []
        if search:
            query += " WHERE name LIKE ?"
            params.append(f"%{search}%")
        if sort == "views":
            query += " ORDER BY view_count DESC, created_at DESC"
        else:
            query += " ORDER BY created_at DESC"
        rows = conn.execute(query, params).fetchall()
        return {"skills": [row_to_dict(r) for r in rows]}
    finally:
        conn.close()


@app.get("/api/skills/{skill_id}")
def get_skill(skill_id: int):
    """获取技能及其完整章节结构"""
    conn = get_db()
    try:
        skill = conn.execute(
            "SELECT id, name, description, created_at, view_count FROM skills WHERE id = ?",
            (skill_id,),
        ).fetchone()

        if not skill:
            raise HTTPException(status_code=404, detail="技能不存在")

        chapters = conn.execute(
            "SELECT id, title, order_num FROM chapters WHERE skill_id = ? ORDER BY order_num",
            (skill_id,),
        ).fetchall()

        chapters_data = []
        for ch in chapters:
            sub_chapters = conn.execute(
                "SELECT id, title, order_num FROM sub_chapters WHERE chapter_id = ? ORDER BY order_num",
                (ch["id"],),
            ).fetchall()

            chapters_data.append({
                **row_to_dict(ch),
                "sub_chapters": [row_to_dict(sc) for sc in sub_chapters],
            })

        return {
            **row_to_dict(skill),
            "chapters": chapters_data,
        }
    finally:
        conn.close()


@app.delete("/api/skills/{skill_id}")
def delete_skill(skill_id: int):
    """删除技能及其所有相关数据"""
    conn = get_db()
    try:
        conn.execute("DELETE FROM skills WHERE id = ?", (skill_id,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


@app.post("/api/skills/{skill_id}/view")
def increment_view(skill_id: int):
    """增加专题访问计数"""
    conn = get_db()
    try:
        conn.execute(
            "UPDATE skills SET view_count = view_count + 1 WHERE id = ?",
            (skill_id,),
        )
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()


# ── Sub-Chapters ──────────────────────────────────────────────────

@app.get("/api/sub-chapters/{sub_chapter_id}")
def get_sub_chapter(sub_chapter_id: int):
    """获取小章节的完整内容（知识点+题目+上下文）"""
    conn = get_db()
    try:
        sc = conn.execute(
            """SELECT sc.*, c.title as chapter_title, c.id as chapter_id,
                      s.name as skill_name, s.id as skill_id
               FROM sub_chapters sc
               JOIN chapters c ON sc.chapter_id = c.id
               JOIN skills s ON c.skill_id = s.id
               WHERE sc.id = ?""",
            (sub_chapter_id,),
        ).fetchone()

        if not sc:
            raise HTTPException(status_code=404, detail="小章节不存在")

        # 知识点（取最新一批）
        kps = conn.execute(
            """SELECT id, content, batch, created_at
               FROM knowledge_points
               WHERE sub_chapter_id = ?
               ORDER BY batch DESC, id ASC""",
            (sub_chapter_id,),
        ).fetchall()

        # 题目
        questions = conn.execute(
            """SELECT id, type, question, options, correct_answer, explanation, batch, created_at
               FROM questions
               WHERE sub_chapter_id = ?
               ORDER BY batch ASC, id ASC""",
            (sub_chapter_id,),
        ).fetchall()

        questions_data = []
        for q in questions:
            qd = row_to_dict(q)
            try:
                qd["options"] = json.loads(qd["options"])
            except (json.JSONDecodeError, TypeError):
                qd["options"] = []
            questions_data.append(qd)

        return {
            **row_to_dict(sc),
            "knowledge_points": [row_to_dict(kp) for kp in kps],
            "questions": questions_data,
            "has_content": len(kps) > 0 and len(questions_data) > 0,
        }
    finally:
        conn.close()


@app.post("/api/sub-chapters/{sub_chapter_id}/generate-content")
def generate_sub_chapter_content(sub_chapter_id: int, req: GenerateContentRequest = GenerateContentRequest()):
    """AI生成小章节的知识点和5道题目"""
    conn = get_db()
    try:
        sc = conn.execute(
            """SELECT sc.*, c.title as chapter_title, s.name as skill_name
               FROM sub_chapters sc
               JOIN chapters c ON sc.chapter_id = c.id
               JOIN skills s ON c.skill_id = s.id
               WHERE sc.id = ?""",
            (sub_chapter_id,),
        ).fetchone()

        if not sc:
            raise HTTPException(status_code=404, detail="小章节不存在")

        # 使用传入的或数据库中的名称
        skill_name = req.skill_name or sc["skill_name"]
        chapter_title = req.chapter_title or sc["chapter_title"]
        sub_title = req.sub_chapter_title or sc["title"]

        # 检查是否已有内容
        existing = conn.execute(
            "SELECT COUNT(*) as cnt FROM knowledge_points WHERE sub_chapter_id = ?",
            (sub_chapter_id,),
        ).fetchone()

        # 调用AI生成
        content = generate_content(skill_name, chapter_title, sub_title)

        # 确定batch号
        batch_num = 1
        if existing["cnt"] > 0:
            max_batch = conn.execute(
                "SELECT MAX(batch) as mb FROM knowledge_points WHERE sub_chapter_id = ?",
                (sub_chapter_id,),
            ).fetchone()
            batch_num = (max_batch["mb"] or 0) + 1

        # 保存知识点
        kp_text = content.get("knowledge_points", "")
        conn.execute(
            "INSERT INTO knowledge_points (sub_chapter_id, content, batch) VALUES (?, ?, ?)",
            (sub_chapter_id, kp_text, batch_num),
        )

        # 保存题目
        for q in content.get("questions", []):
            conn.execute(
                """INSERT INTO questions (sub_chapter_id, type, question, options, correct_answer, explanation, batch)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    sub_chapter_id,
                    q.get("type", "single"),
                    q.get("question", ""),
                    json.dumps(q.get("options", []), ensure_ascii=False),
                    q.get("correct_answer", ""),
                    q.get("explanation", ""),
                    batch_num,
                ),
            )

        conn.commit()
        return get_sub_chapter(sub_chapter_id)
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"生成内容失败: {str(e)}")
    finally:
        conn.close()


@app.post("/api/sub-chapters/{sub_chapter_id}/generate-content-stream")
async def generate_content_stream_endpoint(sub_chapter_id: int, req: GenerateContentRequest = GenerateContentRequest()):
    """流式生成小章节内容 — SSE 端点"""

    async def event_generator():
        conn = get_db()
        try:
            sc = conn.execute(
                """SELECT sc.*, c.title as chapter_title, s.name as skill_name
                   FROM sub_chapters sc
                   JOIN chapters c ON sc.chapter_id = c.id
                   JOIN skills s ON c.skill_id = s.id
                   WHERE sc.id = ?""",
                (sub_chapter_id,),
            ).fetchone()

            if not sc:
                yield f"data: {json.dumps({'type': 'error', 'message': '小章节不存在'})}\n\n"
                return

            skill_name = req.skill_name or sc["skill_name"]
            chapter_title = req.chapter_title or sc["chapter_title"]
            sub_title = req.sub_chapter_title or sc["title"]

            # 流式生成
            full_text = ""
            try:
                for chunk in generate_content_stream(skill_name, chapter_title, sub_title):
                    full_text += chunk
                    yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
                return

            # 解析 JSON
            from ai_service import _parse_json
            try:
                content = _parse_json(full_text)
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'message': f'解析AI返回内容失败: {str(e)}'})}\n\n"
                return

            # 保存到数据库
            existing = conn.execute(
                "SELECT COUNT(*) as cnt FROM knowledge_points WHERE sub_chapter_id = ?",
                (sub_chapter_id,),
            ).fetchone()

            batch_num = 1
            if existing["cnt"] > 0:
                max_batch = conn.execute(
                    "SELECT MAX(batch) as mb FROM knowledge_points WHERE sub_chapter_id = ?",
                    (sub_chapter_id,),
                ).fetchone()
                batch_num = (max_batch["mb"] or 0) + 1

            kp_text = content.get("knowledge_points", "")
            conn.execute(
                "INSERT INTO knowledge_points (sub_chapter_id, content, batch) VALUES (?, ?, ?)",
                (sub_chapter_id, kp_text, batch_num),
            )

            for q in content.get("questions", []):
                conn.execute(
                    """INSERT INTO questions (sub_chapter_id, type, question, options, correct_answer, explanation, batch)
                       VALUES (?, ?, ?, ?, ?, ?, ?)""",
                    (
                        sub_chapter_id,
                        q.get("type", "single"),
                        q.get("question", ""),
                        json.dumps(q.get("options", []), ensure_ascii=False),
                        q.get("correct_answer", ""),
                        q.get("explanation", ""),
                        batch_num,
                    ),
                )

            conn.commit()

            # 发送完成事件
            yield f"data: {json.dumps({'type': 'done', 'message': '生成完成'})}\n\n"

        except Exception as e:
            conn.rollback()
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            conn.close()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/sub-chapters/{sub_chapter_id}/generate-questions")
def generate_extra_questions(sub_chapter_id: int, req: GenerateMoreRequest = GenerateMoreRequest()):
    """为小章节增量生成更多题目"""
    conn = get_db()
    try:
        sc = conn.execute(
            """SELECT sc.*, c.title as chapter_title, s.name as skill_name
               FROM sub_chapters sc
               JOIN chapters c ON sc.chapter_id = c.id
               JOIN skills s ON c.skill_id = s.id
               WHERE sc.id = ?""",
            (sub_chapter_id,),
        ).fetchone()

        if not sc:
            raise HTTPException(status_code=404, detail="小章节不存在")

        skill_name = req.skill_name or sc["skill_name"]
        chapter_title = req.chapter_title or sc["chapter_title"]
        sub_title = req.sub_chapter_title or sc["title"]

        # 获取已有题目
        existing_qs = conn.execute(
            "SELECT type, question FROM questions WHERE sub_chapter_id = ?",
            (sub_chapter_id,),
        ).fetchall()
        existing_list = [{"type": eq["type"], "question": eq["question"]} for eq in existing_qs]

        # 确定batch号
        max_batch = conn.execute(
            "SELECT MAX(batch) as mb FROM questions WHERE sub_chapter_id = ?",
            (sub_chapter_id,),
        ).fetchone()
        batch_num = (max_batch["mb"] or 0) + 1

        # 调用AI生成
        new_questions = generate_more_questions(
            skill_name, chapter_title, sub_title,
            existing_list, count=req.count or 5,
        )

        # 保存
        for q in new_questions:
            conn.execute(
                """INSERT INTO questions (sub_chapter_id, type, question, options, correct_answer, explanation, batch)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    sub_chapter_id,
                    q.get("type", "single"),
                    q.get("question", ""),
                    json.dumps(q.get("options", []), ensure_ascii=False),
                    q.get("correct_answer", ""),
                    q.get("explanation", ""),
                    batch_num,
                ),
            )

        conn.commit()
        return get_sub_chapter(sub_chapter_id)
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail=f"生成题目失败: {str(e)}")
    finally:
        conn.close()


# ── AI 答疑 ───────────────────────────────────────────────────────

@app.post("/api/ai/chat")
def ai_chat(req: ChatRequest):
    """AI答疑（临时对话，不存储）"""
    conn = get_db()
    try:
        q = conn.execute(
            """SELECT q.*, sc.title as sub_chapter_title,
                      c.title as chapter_title, s.name as skill_name
               FROM questions q
               JOIN sub_chapters sc ON q.sub_chapter_id = sc.id
               JOIN chapters c ON sc.chapter_id = c.id
               JOIN skills s ON c.skill_id = s.id
               WHERE q.id = ?""",
            (req.question_id,),
        ).fetchone()

        if not q:
            raise HTTPException(status_code=404, detail="题目不存在")

        question_data = row_to_dict(q)
        try:
            question_data["options"] = json.loads(question_data["options"])
        except (json.JSONDecodeError, TypeError):
            question_data["options"] = []

        context = f"{q['skill_name']} > {q['chapter_title']} > {q['sub_chapter_title']}"
        answer = chat_about_question(question_data, req.query, context)
        return {"answer": answer}
    finally:
        conn.close()


@app.post("/api/ai/chat-stream")
async def ai_chat_stream(req: ChatRequest):
    """流式AI答疑"""

    async def event_generator():
        conn = get_db()
        try:
            q = conn.execute(
                """SELECT q.*, sc.title as sub_chapter_title,
                          c.title as chapter_title, s.name as skill_name
                   FROM questions q
                   JOIN sub_chapters sc ON q.sub_chapter_id = sc.id
                   JOIN chapters c ON sc.chapter_id = c.id
                   JOIN skills s ON c.skill_id = s.id
                   WHERE q.id = ?""",
                (req.question_id,),
            ).fetchone()

            if not q:
                yield f"data: {json.dumps({'type': 'error', 'message': '题目不存在'})}\n\n"
                return

            question_data = row_to_dict(q)
            try:
                question_data["options"] = json.loads(question_data["options"])
            except (json.JSONDecodeError, TypeError):
                question_data["options"] = []

            context = f"{q['skill_name']} > {q['chapter_title']} > {q['sub_chapter_title']}"

            try:
                for chunk in chat_about_question_stream(question_data, req.query, context):
                    yield f"data: {json.dumps({'type': 'chunk', 'content': chunk})}\n\n"
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            conn.close()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── 代码题 AI 评判 ───────────────────────────────────────────────

@app.post("/api/ai/judge-code")
def judge_code(req: JudgeCodeRequest):
    """AI 评判代码/实操题答案"""
    conn = get_db()
    try:
        q = conn.execute(
            """SELECT q.*, sc.title as sub_chapter_title,
                      c.title as chapter_title, s.name as skill_name
               FROM questions q
               JOIN sub_chapters sc ON q.sub_chapter_id = sc.id
               JOIN chapters c ON sc.chapter_id = c.id
               JOIN skills s ON c.skill_id = s.id
               WHERE q.id = ?""",
            (req.question_id,),
        ).fetchone()

        if not q:
            raise HTTPException(status_code=404, detail="题目不存在")

        question_data = row_to_dict(q)
        try:
            question_data["options"] = json.loads(question_data["options"])
        except (json.JSONDecodeError, TypeError):
            question_data["options"] = []

        context = f"{q['skill_name']} > {q['chapter_title']} > {q['sub_chapter_title']}"
        result = judge_code_answer(question_data, req.user_code, context)
        return result
    finally:
        conn.close()


# ── 启动入口 ──────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
