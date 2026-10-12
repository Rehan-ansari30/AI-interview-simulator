import os, re, secrets
from functools import wraps
from flask import Flask, request, jsonify, render_template, session
from werkzeug.security import generate_password_hash, check_password_hash
import database as db
import ai_engine as ai

app = Flask(__name__)
if not os.path.exists("secret.key"):
    open("secret.key", "w").write(secrets.token_hex(32))
app.secret_key = open("secret.key").read()
db.init_db()

TOTAL = 6
CFG = {}  # session_id -> AI settings (kept in memory only; removed when the interview ends)

def err(msg, code=400):
    return jsonify(error=msg), code

def login_required(f):
    @wraps(f)
    def wrap(*a, **k):
        if not session.get("uid"):
            return err("Please log in first.", 401)
        return f(*a, **k)
    return wrap

def own(sid):
    s = db.get_session(sid)
    return s if s and s["user_id"] == session["uid"] else None

def summarize(rows):
    avg = {c: round(sum(r[c] for r in rows) / len(rows), 1) for c in ai.CRITERIA}
    return avg, round(sum(avg.values()) / len(avg) * 10)

@app.after_request
def allow_media(resp):  # tells the browser that this page may use the microphone and camera
    resp.headers["Permissions-Policy"] = "microphone=(self), camera=(self)"
    return resp

@app.route("/")
def home():
    return render_template("index.html")

# ---------- Auth ----------
@app.get("/me")
def me():
    u = db.get_user(session.get("uid"))
    return jsonify(user={"user_id": u["user_id"]} if u else None)

@app.post("/register")
def register():
    d = request.get_json(force=True)
    uid, email, pw = d.get("user_id", "").strip().lower(), d.get("email", "").strip().lower(), d.get("password", "")
    if not re.fullmatch(r"[a-z0-9_]{3,20}", uid):
        return err("User ID must be 3-20 characters: letters, numbers or underscore.")
    if "@" not in email or len(pw) < 6:
        return err("Enter a valid email and a password of at least 6 characters.")
    new = db.create_user(uid, email, generate_password_hash(pw))
    if not new:
        return err("This User ID or email is already registered.")
    session["uid"] = new
    return jsonify(user_id=uid)

@app.post("/login")
def login():
    d = request.get_json(force=True)
    u = db.find_user(d.get("login", "").strip().lower())
    if not u or not check_password_hash(u["pw_hash"], d.get("password", "")):
        return err("Incorrect login details.", 401)
    session.clear()
    session["uid"] = u["id"]
    return jsonify(user_id=u["user_id"])

@app.post("/logout")
def logout():
    session.clear()
    return jsonify(ok=True)

@app.post("/forgot")
def forgot():
    email = request.get_json(force=True).get("email", "").strip().lower()
    code = str(secrets.randbelow(900000) + 100000)
    if db.set_reset_code(email, code):
        # Demo: sending a real email needs SMTP. For now the code is printed in the server terminal.
        print(f"\n*** RESET CODE for {email}: {code} ***\n")
    return jsonify(message="If the email is registered, a reset code has been issued (check the server terminal).")

@app.post("/reset")
def reset():
    d = request.get_json(force=True)
    if len(d.get("password", "")) < 6:
        return err("Password must be at least 6 characters.")
    ok = db.reset_password(d.get("email", "").strip().lower(), d.get("code", "").strip(),
                           generate_password_hash(d["password"]))
    return jsonify(ok=True) if ok else err("Invalid code or email.")

# ---------- Interview ----------
@app.get("/roles")
@login_required
def roles():
    return jsonify(ai.ROLES)

@app.post("/start")
@login_required
def start():
    d = request.get_json(force=True)
    if d.get("role") not in ai.ROLES or d.get("difficulty") not in ("Easy", "Medium", "Hard"):
        return err("Invalid role or difficulty.")
    sid = db.create_session(session["uid"], d["role"], d["difficulty"])
    prov, model, key = d.get("provider"), d.get("model", "").strip(), d.get("key", "").strip()
    cfg = None
    if prov in ai.PROVIDERS:  # a key entered in the browser takes priority, otherwise the .env key
        cfg = {"provider": prov, "key": key, "model": model} if key else ai.server_cfg(prov, model)
    if cfg:
        CFG[sid] = cfg
    return jsonify(session_id=sid, total=TOTAL, ai_live=bool(cfg))

@app.get("/question/<int:sid>")
@login_required
def question(sid):
    s = own(sid)
    if not s:
        return err("Session not found.", 404)
    n = db.count_answers(sid)
    if n >= TOTAL:
        return jsonify(done=True)
    prev = [r["question"] for r in db.get_answers(sid)]
    q, e = ai.generate_question(s["role"], s["difficulty"], n, prev, CFG.get(sid))
    return jsonify(done=False, number=n + 1, total=TOTAL, question=q, ai_error=e)

@app.post("/answer")
@login_required
def answer():
    d = request.get_json(force=True)
    s = own(d.get("session_id"))
    text = d.get("answer", "").strip()
    if not s or not text or db.count_answers(s["id"]) >= TOTAL:
        return err("The answer is empty or the interview is already complete.")
    ev = ai.evaluate_answer(s["role"], d.get("question", ""), text, CFG.get(s["id"]))
    db.save_answer(s["id"], d.get("question", ""), text, ev)
    if db.count_answers(s["id"]) >= TOTAL:  # interview complete: auto-save to history
        db.finalize(s["id"], summarize(db.get_answers(s["id"]))[1])
        CFG.pop(s["id"], None)
    return jsonify(ev)

# ---------- Report, History, Privacy ----------
@app.get("/report/<int:sid>")
@login_required
def report(sid):
    s, rows = own(sid), db.get_answers(sid)
    if not s or not rows:
        return err("Report not found.", 404)
    avg, overall = summarize(rows)
    tips = {"technical": "Revise the key terms and concepts for this role.",
            "communication": "Speak in complete sentences and with confidence.",
            "clarity": "Use short, direct sentences.",
            "relevance": "Answer the question directly first, then add detail.",
            "completeness": "Cover the definition, an example and a use case."}
    weak = [c for c, v in avg.items() if v < 5.5]
    return jsonify(role=s["role"], difficulty=s["difficulty"], date=s["created_at"], overall=overall,
                   averages=avg, strengths=[c.title() for c, v in avg.items() if v >= 7],
                   weaknesses=[c.title() for c in weak],
                   tips=[tips[c] for c in weak] or ["Excellent work! Try a higher difficulty level."], answers=rows)

@app.get("/history")
@login_required
def history():
    return jsonify(db.history(session["uid"]))

@app.delete("/history/<int:sid>")
@login_required
def delete(sid):
    if not own(sid):
        return err("Record not found.", 404)
    db.delete_session(sid)
    return jsonify(ok=True)

if __name__ == "__main__":
    app.run(debug=True)
