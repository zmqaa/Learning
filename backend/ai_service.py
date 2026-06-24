import json
import os
import re
from pathlib import Path
from typing import Generator
import httpx
from dotenv import load_dotenv

# 加载 .env 文件
env_path = Path(__file__).parent / ".env"
load_dotenv(env_path)

API_KEY = os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN", "")
BASE_URL = os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")

# 清理模型名中的标记（如 [1m] 表示 1M context）
MODEL = MODEL.replace("[1m]", "").strip()

# 构建完整 API endpoint
API_URL = BASE_URL.rstrip("/") + "/v1/messages"


def _call_ai(system_prompt: str, user_message: str, max_tokens: int = 4096) -> str:
    """通过 HTTP 直接调用 Anthropic 兼容 API"""
    if not API_KEY:
        raise RuntimeError(
            "API Key 未设置！请在 backend/.env 文件中配置 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN。"
        )

    headers = {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
    }

    body = {
        "model": MODEL,
        "max_tokens": max_tokens,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_message}],
    }

    try:
        resp = httpx.post(API_URL, headers=headers, json=body, timeout=180.0)
        resp.raise_for_status()
        data = resp.json()
        # 从 content 数组中找 type=text 的块（DeepSeek 可能有 thinking 块）
        for block in data["content"]:
            if block.get("type") == "text":
                return block["text"]
        # fallback: 取第一个
        return data["content"][0].get("text", str(data["content"][0]))
    except httpx.HTTPStatusError as e:
        detail = ""
        try:
            detail = e.response.text[:500]
        except Exception:
            pass
        raise RuntimeError(f"API 请求失败 ({e.response.status_code}): {detail}")
    except (KeyError, IndexError) as e:
        raise RuntimeError(f"API 返回格式异常: {e}\n返回内容: {data}")


def _call_ai_stream(system_prompt: str, user_message: str, max_tokens: int = 4096) -> Generator[str, None, None]:
    """流式调用 AI API，逐块返回文本"""
    if not API_KEY:
        raise RuntimeError(
            "API Key 未设置！请在 backend/.env 文件中配置 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN。"
        )

    headers = {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
    }

    body = {
        "model": MODEL,
        "max_tokens": max_tokens,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_message}],
        "stream": True,
    }

    try:
        with httpx.stream("POST", API_URL, headers=headers, json=body, timeout=180.0) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line or not line.startswith("data: "):
                    continue
                data_str = line[6:]
                if data_str == "[DONE]":
                    break
                try:
                    data = json.loads(data_str)
                except json.JSONDecodeError:
                    continue

                # Anthropic 格式: content_block_delta
                if data.get("type") == "content_block_delta":
                    delta = data.get("delta", {})
                    if delta.get("type") == "text_delta":
                        text = delta.get("text", "")
                        if text:
                            yield text
                # OpenAI 兼容格式: choices[0].delta.content
                elif "choices" in data and len(data["choices"]) > 0:
                    delta = data["choices"][0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        yield content
    except httpx.HTTPStatusError as e:
        detail = ""
        try:
            detail = e.response.text[:500]
        except Exception:
            pass
        raise RuntimeError(f"API 请求失败 ({e.response.status_code}): {detail}")


def _parse_json(text: str) -> dict:
    """从 AI 返回的文本中提取 JSON"""
    # 尝试直接解析
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # 尝试提取 ```json ... ``` 代码块
    match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # 尝试找到第一个 { 和最后一个 }
    first_brace = text.find('{')
    last_brace = text.rfind('}')
    if first_brace != -1 and last_brace != -1:
        try:
            return json.loads(text[first_brace:last_brace + 1])
        except json.JSONDecodeError:
            pass

    raise ValueError(f"无法解析 AI 返回的 JSON，原始内容: {text[:500]}...")


def generate_chapters(skill_name: str) -> dict:
    """根据技能/证书名称生成大章节和小章节结构"""
    system_prompt = """你是一位专业的考试备考专家和课程设计师。你的任务是为各类考试或技能生成完整、合理的章节大纲。

规则：
1. 章节结构要符合该考试/技能的实际知识体系
2. 大章节8-12个，每个大章节包含3-6个小章节
3. 标题简洁明确，使用中文
4. 章节排序要符合学习的逻辑顺序（由浅入深）

你必须只返回JSON，不要有任何其他文字。"""

    user_message = f'请为"{skill_name}"生成完整的章节大纲。返回JSON格式：{{"chapters":[{{"title":"大章节标题","sub_chapters":["小章节1","小章节2"]}}]}}'

    text = _call_ai(system_prompt, user_message)
    return _parse_json(text)


def generate_content(skill_name: str, chapter_title: str, sub_chapter_title: str) -> dict:
    """为小章节生成知识点和题目"""
    system_prompt = """你是一位资深的考试命题专家和教师。你的任务是为指定的小章节生成高质量的学习内容和练习题。

规则：
1. 知识点部分：用Markdown格式，包含核心概念、重点公式、记忆要点、常见误区等，约400-600字
2. 题目部分：共5道题（3道单选题、1道多选题、1道简答题/大题）
3. 题目要有代表性，覆盖该小节的核心考点，难度适中
4. 单选题4个选项，多选题4-5个选项
5. 每道题都要有详细的答案解析，解释正确答案的原因和错误选项的问题
6. 简答题要给出参考答案要点和评分思路
7. 重要：对于需要实际编写代码、SQL、命令行的章节（如SQL查询、编程语法、Shell命令等），
   可以将简答题替换为 code 类型实操题（共5道题中最多1道code题，只在确实需要动手实操的章节才出code题）。
   code题需要给出明确的问题描述、参考答案代码、以及评分要点。纯粹的理论记忆型章节不要出code题。

你必须只返回JSON，不要有任何其他文字。"""

    user_message = f"""请为以下章节生成学习内容：
- 考试/技能：{skill_name}
- 大章节：{chapter_title}
- 小章节：{sub_chapter_title}

返回JSON格式（code 类型仅在需要实操的章节才使用，最多1道，可不出）：
{{
  "knowledge_points": "Markdown格式的知识点内容",
  "questions": [
    {{
      "type": "single",
      "question": "题目内容",
      "options": ["A. 选项1", "B. 选项2", "C. 选项3", "D. 选项4"],
      "correct_answer": "A",
      "explanation": "详细解析"
    }},
    {{
      "type": "multi",
      "question": "多选题题目",
      "options": ["A. 选项1", "B. 选项2", "C. 选项3", "D. 选项4", "E. 选项5"],
      "correct_answer": "AB",
      "explanation": "详细解析"
    }},
    {{
      "type": "essay",
      "question": "简答题题目",
      "correct_answer": "参考答案要点",
      "explanation": "解题思路和评分标准"
    }},
    {{
      "type": "code",
      "question": "实操题描述（如：编写SQL查询...）",
      "correct_answer": "参考答案代码",
      "explanation": "评分要点和解题思路"
    }}
  ]
}}"""

    text = _call_ai(system_prompt, user_message)
    return _parse_json(text)


def generate_content_stream(skill_name: str, chapter_title: str, sub_chapter_title: str) -> Generator[str, None, None]:
    """流式生成小章节内容，逐块返回文本"""
    system_prompt = """你是一位资深的考试命题专家和教师。你的任务是为指定的小章节生成高质量的学习内容和练习题。

规则：
1. 知识点部分：用Markdown格式，包含核心概念、重点公式、记忆要点、常见误区等，约400-600字
2. 题目部分：共5道题（3道单选题、1道多选题、1道简答题/大题）
3. 题目要有代表性，覆盖该小节的核心考点，难度适中
4. 单选题4个选项，多选题4-5个选项
5. 每道题都要有详细的答案解析，解释正确答案的原因和错误选项的问题
6. 简答题要给出参考答案要点和评分思路
7. 重要：对于需要实际编写代码、SQL、命令行的章节（如SQL查询、编程语法、Shell命令等），
   可以将简答题替换为 code 类型实操题（共5道题中最多1道code题，只在确实需要动手实操的章节才出code题）。
   code题需要给出明确的问题描述、参考答案代码、以及评分要点。纯粹的理论记忆型章节不要出code题。

你必须只返回JSON，不要有任何其他文字。"""

    user_message = f"""请为以下章节生成学习内容：
- 考试/技能：{skill_name}
- 大章节：{chapter_title}
- 小章节：{sub_chapter_title}

返回JSON格式（code 类型仅在需要实操的章节才使用，最多1道，可不出）：
{{
  "knowledge_points": "Markdown格式的知识点内容",
  "questions": [
    {{
      "type": "single",
      "question": "题目内容",
      "options": ["A. 选项1", "B. 选项2", "C. 选项3", "D. 选项4"],
      "correct_answer": "A",
      "explanation": "详细解析"
    }},
    {{
      "type": "multi",
      "question": "多选题题目",
      "options": ["A. 选项1", "B. 选项2", "C. 选项3", "D. 选项4", "E. 选项5"],
      "correct_answer": "AB",
      "explanation": "详细解析"
    }},
    {{
      "type": "essay",
      "question": "简答题题目",
      "correct_answer": "参考答案要点",
      "explanation": "解题思路和评分标准"
    }},
    {{
      "type": "code",
      "question": "实操题描述（如：编写SQL查询...）",
      "correct_answer": "参考答案代码",
      "explanation": "评分要点和解题思路"
    }}
  ]
}}"""

    return _call_ai_stream(system_prompt, user_message)


def generate_more_questions(skill_name: str, chapter_title: str, sub_chapter_title: str,
                            existing_questions: list, count: int = 5) -> list:
    """为小章节生成额外的题目（增量）"""
    existing_summary = "\n".join(
        [f"- {q['type']}: {q['question'][:60]}..." for q in existing_questions[-10:]]
    ) if existing_questions else "（暂无已有题目）"

    system_prompt = """你是一位资深的考试命题专家。你的任务是为指定的小章节生成额外的练习题。
这些题目的风格和难度要与已有的题目保持一致，但内容不能重复。
题目类型可以是 single（单选）、multi（多选）、essay（简答）、code（实操编程/SQL等）。
code 类型只在需要动手写代码的章节才使用，理论章节不要出。

你必须只返回JSON，不要有任何其他文字。"""

    user_message = f"""请为以下章节生成{count}道额外的新题目：
- 考试/技能：{skill_name}
- 大章节：{chapter_title}
- 小章节：{sub_chapter_title}
- 已有题目（请避免重复）：
{existing_summary}

返回JSON格式：
{{
  "questions": [
    {{
      "type": "single|multi|essay",
      "question": "题目内容",
      "options": ["A. ...", "B. ..."],
      "correct_answer": "答案",
      "explanation": "详细解析"
    }}
  ]
}}"""

    text = _call_ai(system_prompt, user_message, max_tokens=8192)
    result = _parse_json(text)
    return result.get("questions", [])


def chat_about_question(question: dict, user_query: str, skill_context: str = "") -> str:
    """针对某道题进行AI对话答疑（临时，不存储）"""
    system_prompt = """你是一位耐心的辅导老师。学生正在做一道练习题，对题目有疑问。
请用通俗易懂的方式解答学生的问题，帮助他理解知识点，而不是直接给答案。
如果学生问的是解题思路，请引导他自己思考。
如果学生问"为什么答案是X"或"这道题为什么选X"，请详细解释原因。"""

    question_text = f"""题目：{question['question']}
类型：{question['type']}
选项：{json.dumps(question.get('options', []), ensure_ascii=False)}
正确答案：{question.get('correct_answer', 'N/A')}
解析：{question.get('explanation', 'N/A')}"""

    user_message = f"""背景：{skill_context}

题目信息：
{question_text}

学生的问题：{user_query}

请回答学生的问题。"""

    text = _call_ai(system_prompt, user_message, max_tokens=2048)
    return text


def chat_about_question_stream(question: dict, user_query: str, skill_context: str = "") -> Generator[str, None, None]:
    """流式答疑"""
    system_prompt = """你是一位耐心的辅导老师。学生正在做一道练习题，对题目有疑问。
请用通俗易懂的方式解答学生的问题，帮助他理解知识点，而不是直接给答案。
如果学生问的是解题思路，请引导他自己思考。
如果学生问"为什么答案是X"或"这道题为什么选X"，请详细解释原因。"""

    question_text = f"""题目：{question['question']}
类型：{question['type']}
选项：{json.dumps(question.get('options', []), ensure_ascii=False)}
正确答案：{question.get('correct_answer', 'N/A')}
解析：{question.get('explanation', 'N/A')}"""

    user_message = f"""背景：{skill_context}

题目信息：
{question_text}

学生的问题：{user_query}

请回答学生的问题。"""

    return _call_ai_stream(system_prompt, user_message, max_tokens=2048)


def judge_code_answer(question: dict, user_code: str, skill_context: str = "") -> dict:
    """AI 评判代码/实操题答案，返回 {correct: bool, feedback: str}"""
    system_prompt = """你是一位严格的编程教师和代码审查者。你的任务是评判学生提交的代码/实操题答案。

规则：
1. 不要只看字符串是否匹配，要理解代码的语义（SQL、Python、Shell 等）
2. 代码逻辑正确即可判定为正确，允许变量名、格式、大小写等合理差异
3. 对于 SQL 查询，关注查询逻辑是否正确，不要求字符串完全一致
4. 如果答案错误，要指出具体哪里不对，并给出改进建议
5. 如果答案正确，简要肯定并可以给出优化建议

你必须只返回JSON，不要有任何其他文字。"""

    user_message = f"""背景：{skill_context}

题目：{question['question']}
参考答案：{question.get('correct_answer', 'N/A')}
评分要点：{question.get('explanation', 'N/A')}

学生提交的代码：
```
{user_code}
```

请评判这个答案。返回JSON格式：
{{
  "correct": true/false,
  "feedback": "你的评判和反馈（Markdown格式，简洁明了）"
}}"""

    text = _call_ai(system_prompt, user_message, max_tokens=1024)
    result = _parse_json(text)
    return {
        "correct": result.get("correct", False),
        "feedback": result.get("feedback", "评判完成"),
    }
