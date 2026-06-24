import sqlite3
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "learning.db")


def get_db():
    """获取数据库连接"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """初始化数据库表"""
    conn = get_db()
    cursor = conn.cursor()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS skills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS chapters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            skill_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            order_num INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS sub_chapters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chapter_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            order_num INTEGER NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS knowledge_points (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sub_chapter_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            batch INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sub_chapter_id) REFERENCES sub_chapters(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS questions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sub_chapter_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            question TEXT NOT NULL,
            options TEXT DEFAULT '[]',
            correct_answer TEXT NOT NULL,
            explanation TEXT NOT NULL,
            batch INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (sub_chapter_id) REFERENCES sub_chapters(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_chapters_skill ON chapters(skill_id);
        CREATE INDEX IF NOT EXISTS idx_sub_chapters_chapter ON sub_chapters(chapter_id);
        CREATE INDEX IF NOT EXISTS idx_knowledge_points_sub ON knowledge_points(sub_chapter_id);
        CREATE INDEX IF NOT EXISTS idx_questions_sub ON questions(sub_chapter_id);
    """)

    # 迁移：移除旧的 CHECK 约束（SQLite 不支持 ALTER CONSTRAINT，重建表）
    try:
        cursor.execute("SELECT type FROM questions LIMIT 1")
    except sqlite3.OperationalError:
        # 表不存在或没有问题
        pass
    else:
        # 检查是否存在旧的 CHECK 约束（尝试插入 code 类型看是否报错）
        try:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS questions_v2 (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sub_chapter_id INTEGER NOT NULL,
                    type TEXT NOT NULL,
                    question TEXT NOT NULL,
                    options TEXT DEFAULT '[]',
                    correct_answer TEXT NOT NULL,
                    explanation TEXT NOT NULL,
                    batch INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (sub_chapter_id) REFERENCES sub_chapters(id) ON DELETE CASCADE
                )
            """)
            # 检查旧表是否有 CHECK 约束（通过 schema）
            cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='questions'")
            old_sql = cursor.fetchone()
            if old_sql and 'CHECK' in (old_sql[0] or ''):
                cursor.execute("INSERT INTO questions_v2 SELECT * FROM questions")
                cursor.execute("DROP TABLE questions")
                cursor.execute("ALTER TABLE questions_v2 RENAME TO questions")
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_questions_sub
                    ON questions(sub_chapter_id)
                """)
            else:
                cursor.execute("DROP TABLE questions_v2")
        except Exception:
            pass

    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_db()
    print(f"Database initialized at {DB_PATH}")
