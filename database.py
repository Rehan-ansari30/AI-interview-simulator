import sqlite3

DB = "interview_v2.db"

def conn():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c

def init_db():
    with conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS users(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
            pw_hash TEXT NOT NULL, reset_code TEXT);
        CREATE TABLE IF NOT EXISTS sessions(
            id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER,
            role TEXT, difficulty TEXT, overall INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS answers(
            id INTEGER PRIMARY KEY AUTOINCREMENT, session_id INTEGER,
            question TEXT, answer TEXT, technical INTEGER, communication INTEGER,
            clarity INTEGER, relevance INTEGER, completeness INTEGER,
            feedback TEXT, mistakes TEXT, ideal TEXT);
        """)

def create_user(uid, email, pw_hash):
    try:
        with conn() as c:
            return c.execute("INSERT INTO users(user_id,email,pw_hash) VALUES(?,?,?)",
                             (uid, email, pw_hash)).lastrowid
    except sqlite3.IntegrityError:
        return None

def find_user(login):
    with conn() as c:
        return c.execute("SELECT * FROM users WHERE email=? OR user_id=?", (login, login)).fetchone()

def get_user(uid):
    with conn() as c:
        return c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()

def set_reset_code(email, code):
    with conn() as c:
        return c.execute("UPDATE users SET reset_code=? WHERE email=?", (code, email)).rowcount

def reset_password(email, code, pw_hash):
    with conn() as c:
        return c.execute("UPDATE users SET pw_hash=?, reset_code=NULL WHERE email=? AND reset_code=?",
                         (pw_hash, email, code)).rowcount

def create_session(uid, role, difficulty):
    with conn() as c:
        return c.execute("INSERT INTO sessions(user_id,role,difficulty) VALUES(?,?,?)",
                         (uid, role, difficulty)).lastrowid

def get_session(sid):
    with conn() as c:
        return c.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()

def count_answers(sid):
    with conn() as c:
        return c.execute("SELECT COUNT(*) n FROM answers WHERE session_id=?", (sid,)).fetchone()["n"]

def save_answer(sid, q, a, ev):
    with conn() as c:
        c.execute("""INSERT INTO answers(session_id,question,answer,technical,communication,clarity,
                     relevance,completeness,feedback,mistakes,ideal) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
                  (sid, q, a, ev["technical"], ev["communication"], ev["clarity"], ev["relevance"],
                   ev["completeness"], ev["feedback"], ev.get("mistakes", ""), ev.get("ideal", "")))

def get_answers(sid):
    with conn() as c:
        return [dict(r) for r in c.execute("SELECT * FROM answers WHERE session_id=? ORDER BY id", (sid,))]

def finalize(sid, overall):
    with conn() as c:
        c.execute("UPDATE sessions SET overall=? WHERE id=?", (overall, sid))

def history(uid):
    with conn() as c:
        return [dict(r) for r in c.execute(
            "SELECT id,role,difficulty,overall,created_at FROM sessions "
            "WHERE user_id=? AND overall IS NOT NULL ORDER BY id DESC", (uid,))]

def delete_session(sid):
    with conn() as c:
        c.execute("DELETE FROM answers WHERE session_id=?", (sid,))
        c.execute("DELETE FROM sessions WHERE id=?", (sid,))
