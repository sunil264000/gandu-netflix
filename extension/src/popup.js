const $ = (id) => document.getElementById(id);
const app = document.getElementById("app");
const SITE = "https://sparkle-unlock-guard.lovable.app";

let tickTimer = null;

function h(html) { app.innerHTML = html; }
function send(type, data = {}) { return new Promise((r) => chrome.runtime.sendMessage({ type, ...data }, r)); }

function fmt(sec) {
  if (sec <= 0) return "00:00";
  const d = Math.floor(sec / 86400);
  const h_ = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h_}h ${m}m`;
  if (h_ > 0) return `${h_}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

async function render() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  const s = await send("status");
  if (s.revoked) return renderRevoked(s);
  if (!s.activated) return renderActivate();
  return renderMain(s);
}

function header() {
  return `<div class="hd"><div class="logo"></div><div><h1>Lovable Infinity</h1><div class="sub">v2.0.0 · Hardened</div></div></div>`;
}

function renderActivate() {
  h(`${header()}
    <div class="card">
      <label>License key</label>
      <input id="lic" type="text" placeholder="LIF-XXXX-XXXX-XXXX-XXXX" autocomplete="off" />
      <div style="height:10px"></div>
      <button id="go">Activate</button>
      <div id="err" class="err"></div>
      <div class="hint">Countdown starts the moment you activate.<br/>Need a key? <a href="${SITE}" target="_blank" style="color:#3b82f6">Get one — 15 min free</a></div>
    </div>`);
  $("go").onclick = async () => {
    $("go").disabled = true; $("err").textContent = "";
    const r = await send("activate", { license_key: $("lic").value.trim() });
    if (r?.error) { $("err").textContent = friendly(r.error); $("go").disabled = false; }
    else render();
  };
}

function renderRevoked(s) {
  const expired = s.revoke_reason === "expired";
  h(`${header()}
    <div class="card">
      <div class="row"><strong>${expired ? "Time's up" : "License disabled"}</strong><span class="pill bad">${expired ? "Expired" : "Revoked"}</span></div>
      <p class="muted">${expired ? "Your license has expired. Grab a new one and paste it here." : `Reason: ${s.revoke_reason ?? "unknown"}.`}</p>
      <a href="${SITE}/dashboard" target="_blank"><button style="width:100%">Get a new key</button></a>
      <div style="height:8px"></div>
      <button id="reset" class="secondary">Sign out</button>
    </div>`);
  $("reset").onclick = async () => { await send("sign_out"); render(); };
}

function renderMain(s) {
  const hasExp = !!s.expires_at;
  const tickHtml = hasExp ? `<div class="row" style="margin-top:10px"><span class="muted">Time left</span><strong id="countdown" style="font-size:20px;font-family:'SF Mono',Menlo,monospace">--:--</strong></div>` : "";
  h(`${header()}
    <div class="card">
      <div class="row">
        <div><strong>${s.plan?.name ?? "Plan"}${s.is_trial ? " · Trial" : ""}</strong><div class="muted">${s.plan?.code ?? ""}</div></div>
        <span class="pill ok">Active</span>
      </div>
      ${tickHtml}
      <div class="row" style="margin-top:10px">
        <span class="muted">Credits remaining</span>
        <strong>${s.credits ?? "—"}</strong>
      </div>
    </div>
    <div class="card">
      <label>Ask AI</label>
      <textarea id="q" rows="3" placeholder="Summarize this page in 3 bullets…"></textarea>
      <div style="height:8px"></div>
      <button id="run">Send · 1 credit</button>
      <div id="err" class="err"></div>
      <div id="out"></div>
    </div>
    <div class="row">
      <button class="secondary" id="signout" style="width:auto;padding:6px 10px">Sign out</button>
      <a href="${SITE}/dashboard" target="_blank" class="muted" style="text-decoration:none;font-size:12px">Extend →</a>
    </div>`);

  if (hasExp) {
    const tick = () => {
      const left = Math.max(0, Math.floor((s.expires_at - Date.now()) / 1000));
      const el = $("countdown");
      if (!el) return;
      el.textContent = fmt(left);
      el.style.color = left < 60 ? "#ef4444" : left < 300 ? "#f59e0b" : "#0f172a";
      if (left <= 0) { clearInterval(tickTimer); render(); }
    };
    tick();
    tickTimer = setInterval(tick, 1000);
  }

  $("run").onclick = async () => {
    $("run").disabled = true; $("err").textContent = ""; $("out").innerHTML = "";
    const r = await send("exec", { action: "ai.chat", input: { prompt: $("q").value } });
    $("run").disabled = false;
    if (r?.error) { $("err").textContent = friendly(r.error); if (r.error === "license_expired") render(); }
    else {
      $("out").innerHTML = `<pre class="out">${escapeHtml(r.result?.text ?? JSON.stringify(r.result))}</pre>`;
    }
  };
  $("signout").onclick = async () => { await send("sign_out"); render(); };
}

function friendly(e) {
  const m = {
    invalid_license: "That key wasn't found. Double-check and try again.",
    license_expired: "This license has expired. Get a new one on the dashboard.",
    license_revoked: "This license was revoked. Contact support.",
    device_limit: "This key has reached its device limit.",
    device_revoked: "This device was revoked for this key.",
    trial_device_used: "Free trial already used on this device.",
    replay: "Request rejected (clock skew). Try again.",
  };
  return m[e] ?? e;
}

function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

render();
