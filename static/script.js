const $ = id => document.getElementById(id);
const S = { role: null, level: null, sid: null, question: "", chart: null };
const CRIT = ["technical", "communication", "clarity", "relevance", "completeness"];
const VIEWS = ["s-auth", "s-setup", "s-interview", "s-report", "s-history"];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const cap = c => c[0].toUpperCase() + c.slice(1);

function show(id) { VIEWS.forEach(v => $(v).classList.add("hidden")); $(id).classList.remove("hidden"); err(""); }
function err(m) { $("error").textContent = m; $("error").classList.toggle("hidden", !m); }
function form(id) { ["f-login", "f-reg", "f-forgot"].forEach(f => $(f).classList.add("hidden")); $(id).classList.remove("hidden"); err(""); }
document.querySelectorAll("[data-go]").forEach(a => a.onclick = () => form(a.dataset.go));

async function api(url, body, method) {
  try {
    const r = await fetch(url, { method: method || (body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const d = await r.json();
    if (r.status === 401 && url !== "/login") { toLogin(); }
    if (!r.ok) throw new Error(d.error || "Something went wrong. Please try again.");
    return d;
  } catch (e) { err(e.message); throw e; }
}
const menuButton = $("btn-menu");
const menuPanel = $("menu-panel");

menuButton.onclick = () => {
  const opening = menuPanel.classList.contains("hidden");

  menuPanel.classList.toggle("hidden");
  menuButton.setAttribute("aria-expanded", String(opening));
};

document.addEventListener("click", (event) => {
  if (
    !menuPanel.contains(event.target) &&
    !menuButton.contains(event.target)
  ) {
    menuPanel.classList.add("hidden");
    menuButton.setAttribute("aria-expanded", "false");
  }
});

$("btn-new-menu").onclick = () => {
  menuPanel.classList.add("hidden");
  loadSetup();
  show("s-setup");
};
// ---------- Auth ----------
function toLogin() { $("nav").classList.add("hidden"); form("f-login"); show("s-auth"); }
function enter(uid) { $("who").textContent = uid; $("nav").classList.remove("hidden"); loadSetup(); show("s-setup"); }
$("btn-login").onclick = async () => enter((await api("/login", { login: $("l-login").value, password: $("l-pass").value })).user_id);
$("btn-reg").onclick = async () => enter((await api("/register", { user_id: $("r-uid").value, email: $("r-email").value, password: $("r-pass").value })).user_id);
$("btn-logout").onclick = async () => { stopCam(); await api("/logout", {}); toLogin(); };
$("btn-code").onclick = async () => err((await api("/forgot", { email: $("fg-email").value })).message);
$("btn-reset").onclick = async () => {
  await api("/reset", { email: $("fg-email").value, code: $("fg-code").value, password: $("fg-pass").value });
  form("f-login"); err("Your password has been reset. Please log in.");
};

// ---------- Setup ----------
async function loadSetup() {
  S.role = S.level = null; $("btn-start").disabled = true;
  document.querySelectorAll("#levels .choice").forEach(c => c.classList.remove("on"));
  const roles = await api("/roles");
  $("roles").innerHTML = "";
  roles.forEach(r => {
    const b = document.createElement("button");
    b.className = "choice"; b.textContent = r;
    b.onclick = () => pick("roles", b, () => S.role = r);
    $("roles").appendChild(b);
  });
}
function pick(group, el, set) {
  document.querySelectorAll("#" + group + " .choice").forEach(c => c.classList.remove("on"));
  el.classList.add("on"); set(); $("btn-start").disabled = !(S.role && S.level);
}
document.querySelectorAll("#levels .choice").forEach(b => b.onclick = () => pick("levels", b, () => S.level = b.dataset.level));

// ---------- Interview ----------
$("btn-start").onclick = async () => {
  const d = await api("/start", { role: S.role, difficulty: S.level, provider: $("provider").value,
                                  key: $("apikey").value, model: $("model").value });
  S.noKey = $("provider").value && !d.ai_live; S.sid = d.session_id; show("s-interview"); nextQuestion();
};
async function nextQuestion() {
  const d = await api("/question/" + S.sid);
  if (d.done) return openReview(S.sid);
  S.question = d.question;
  $("qmeta").textContent = `Question ${d.number} of ${d.total} - ${S.role} (${S.level})`;
  $("progress").style.width = ((d.number - 1) / d.total * 100) + "%";
  $("question").textContent = d.question;
  $("answer").value = ""; $("result").classList.add("hidden"); $("btn-submit").disabled = false;
  err(d.ai_error ? "AI request failed; a built-in question was used instead. Details: " + d.ai_error : S.noKey ? "No API key was found for this provider (key box or .env). Running in demo mode." : "");
}
$("btn-submit").onclick = async () => {
  if (!$("answer").value.trim()) return err("Please enter an answer first.");
  $("btn-submit").disabled = true;
  try {
    const ev = await api("/answer", { session_id: S.sid, question: S.question, answer: $("answer").value });
    $("scores").innerHTML = CRIT.map(c => `<span class="score">${c}<br><b>${ev[c]}/10</b></span>`).join("");
    $("feedback").textContent = ev.feedback;
    $("followup").textContent = "Follow-up to think about: " + ev.follow_up;
    $("result").classList.remove("hidden");
    err(ev.ai_error ? "AI request failed; built-in scoring was used instead. Details: " + ev.ai_error : "");
  } catch (e) { $("btn-submit").disabled = false; }
};
$("btn-next").onclick = nextQuestion;
$("btn-mic").onclick = async () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return err("Voice input is not supported in this browser. Please use Chrome or Edge.");
  if (!navigator.mediaDevices) return err("To use the microphone, open this page at http://127.0.0.1:5000 or http://localhost:5000 (not an IP address).");
  try {  // first trigger the microphone permission prompt
    (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach(t => t.stop());
  } catch (e) {
    return err(e.name === "NotAllowedError" ? "Microphone permission is blocked. Click the lock icon in the address bar, open Site settings, set Microphone to Allow, then refresh the page."
      : e.name === "NotFoundError" ? "No microphone was found. Check that one is connected and that Windows Settings > Privacy > Microphone allows access."
      : e.name === "NotReadableError" ? "The microphone is being used by another application. Please close it and try again."
      : "Mic error: " + e.name);
  }
  const rec = new SR(); rec.lang = "en-IN";
  rec.onresult = e => $("answer").value += e.results[0][0].transcript + " ";
  const MSG = { "not-allowed": "Microphone permission is blocked. Click the lock icon in the address bar, open Site settings, set Microphone to Allow, then refresh the page.",
    "service-not-allowed": "Microphone permission is blocked. Click the lock icon in the address bar, open Site settings, and set Microphone to Allow.",
    "audio-capture": "No microphone was found. Check that it is connected and that Windows Settings > Privacy > Microphone allows access.",
    "network": "Voice input requires an internet connection (it uses the browser's speech service).",
    "no-speech": "No speech was detected. Please try again." };
  rec.onerror = e => err(MSG[e.error] || "Mic error: " + e.error);
  rec.onstart = () => { $("btn-mic").textContent = "Listening..."; err(""); };
  rec.onend = () => { $("btn-mic").textContent = "Speak answer"; };
  try { rec.start(); } catch (e) { err("The microphone is already active. Please wait a moment."); }
};

// ---------- Report / History ----------
async function openReview(id) {
  stopCam();
  const r = await api("/report/" + id);
  show("s-report");
  $("overall").textContent = r.overall + "/100";
  $("rolelabel").textContent = `${r.role} - ${r.difficulty} - ${r.date}`;
  $("strengths").textContent = r.strengths.join(", ") || "No clear strengths yet. Keep practicing.";
  $("weaknesses").textContent = r.weaknesses.join(", ") || "No major weak areas.";
  $("tips").innerHTML = r.tips.map(t => `<li>${esc(t)}</li>`).join("");
  $("details").innerHTML = r.answers.map((a, i) => `<div class="detail"><b>Q${i + 1}. ${esc(a.question)}</b>
    <p><small>Your answer:</small> ${esc(a.answer)}</p>
    <p><small>${CRIT.map(c => cap(c) + ": " + a[c] + "/10").join(" | ")}</small></p>
    <p>${esc(a.feedback)}</p><p><b>Mistakes:</b> ${esc(a.mistakes || "-")}</p>
    <p><b>Correct answer:</b> ${esc(a.ideal || "-")}</p></div>`).join("");
  if (S.chart) S.chart.destroy();
  S.chart = new Chart($("chart"), { type: "bar",
    data: { labels: CRIT.map(cap), datasets: [{ label: "Average score (out of 10)", data: CRIT.map(c => r.averages[c]), backgroundColor: "#2f6df6" }] },
    options: { scales: { y: { min: 0, max: 10 } } } });
}
async function loadHistory() {
  const h = await api("/history");
  show("s-history");
  $("hlist").innerHTML = h.length ? h.map(x => `<div class="hrow"><div><b>${esc(x.role)}</b> (${esc(x.difficulty)})<br><small>${esc(x.created_at)}</small></div>
    <strong>${x.overall}/100</strong><div><button data-v="${x.id}">View Detailed Review</button> <button class="ghost" data-d="${x.id}">Delete</button></div></div>`).join("")
    : "<p>No completed interviews yet.</p>";
}
$("hlist").onclick = async e => {
  if (e.target.dataset.v) openReview(e.target.dataset.v);
  if (e.target.dataset.d && confirm("This interview record will be permanently deleted. Do you want to continue?")) {
    await api("/history/" + e.target.dataset.d, null, "DELETE"); loadHistory();
  }
};
$("btn-hist").onclick = loadHistory; $("btn-back").onclick = loadHistory;
$("btn-again").onclick = () => { loadSetup(); show("s-setup"); };
$("btn-new").onclick = () => { loadSetup(); show("s-setup"); };

// ---------- Start ----------
api("/me").then(d => d.user ? enter(d.user.user_id) : toLogin());

// ---------- Camera (preview on your screen only; nothing is uploaded) ----------
let camStream = null;
function stopCam() {
  if (camStream) camStream.getTracks().forEach(t => t.stop());
  camStream = null; $("cam").classList.add("hidden"); $("btn-cam").textContent = "Camera on";
}
$("btn-cam").onclick = async () => {
  if (camStream) return stopCam();
  if (!navigator.mediaDevices) return err("To use the camera, open this page at http://127.0.0.1:5000 or http://localhost:5000.");
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: true });
    $("cam").srcObject = camStream; $("cam").classList.remove("hidden");
    $("btn-cam").textContent = "Camera off"; err("");
  } catch (e) {
    err(e.name === "NotAllowedError" ? "Camera permission is blocked. Click the lock icon in the address bar, open Site settings, set Camera to Allow, then refresh the page."
      : e.name === "NotFoundError" ? "No camera was found. Check your laptop camera or webcam."
      : e.name === "NotReadableError" ? "The camera is being used by another application (for example Zoom or Teams). Please close it and try again."
      : "Camera error: " + e.name);
  }
};