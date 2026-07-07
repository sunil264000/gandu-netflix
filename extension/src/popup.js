// ============================================================
// Lovable Infinity — popup UI
// Defensive: always renders something, even if background SW
// is cold, crashed, or returns nothing.
// ============================================================

const SITE = "https://sparkle-unlock-guard.lovable.app";
const app = document.getElementById("app");
const $ = (id) => document.getElementById(id);

let tickTimer = null;

function send(type, data = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      chrome.runtime.sendMessage({ type, ...data }, (r) => {
        if (chrome.runtime.lastError) return finish({ error: chrome.runtime.lastError.message });
        finish(r ?? { error: "no_response" });
      });
    } catch (e) { finish({ error: String(e.message ?? e) }); }
    // Fallback in case SW never responds
    setTimeout(() => finish({ error: "timeout" }), 8000);
  });
}

function fmt(sec) {
  if (sec <= 0) return "00:00";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
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
    missing_fields: "Please enter your full license key.",
    no_response: "Extension background not responding. Try reopening.",
    timeout: "Server timed out. Check your connection.",
    not_activated: "No active license. Activate one first.",
  };
  return m[e] ?? (e || "Unknown error");
}

function header() {
  return `<div class="hd">
    <img class="logo" src="icon.png" alt="" />
    <div>
      <h1>Lovable Infinity</h1>
      <div class="sub">v2.0.0 · Hardened</div>
    </div>
  </div>`;
}

function h(html) { app.innerHTML = html; }

async function render() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
  // Render skeleton first so popup is never blank
  h(`${header()}<div class="card"><div class="muted">Loading…</div></div>`);
  let s;
  try { s = await send("status"); } catch (e) { s = { error: String(e) }; }

  if (s?.error) return renderError(s.error);
  if (s.tampered) return renderTampered();
  if (s.revoked) return renderRevoked(s);
  if (!s.activated) return renderActivate();
  return renderMain(s);
}

function renderError(err) {
  h(`${header()}
    <div class="card">
      <div class="row"><strong>Can't reach extension</strong><span class="pill bad">Error</span></div>
      <p class="muted">${escapeHtml(friendly(err))}</p>
      <button id="retry">Retry</button>
    </div>`);
  $("retry").onclick = () => render();
}

function renderTampered() {
  h(`${header()}
    <div class="card">
      <div class="row"><strong>Integrity check failed</strong><span class="pill bad">Tampered</span></div>
      <p class="muted">Reinstall the extension from a trusted source.</p>
      <a href="${SITE}" target="_blank"><button>Get fresh copy</button></a>
    </div>`);
}

function renderActivate() {
  h(`${header()}
    <div class="card">
      <label for="lic">License key</label>
      <input id="lic" type="text" placeholder="LIF-XXXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false" />
      <div style="height:10px"></div>
      <button id="go">Activate</button>
      <div id="err" class="err"></div>
      <div class="hint">Countdown starts the moment you activate.<br/>
        Need a key? <a href="${SITE}" target="_blank">Get one — 15 min free</a>
      </div>
    </div>
    <div class="row">
      <a href="${SITE}/dashboard" target="_blank" class="muted small">Dashboard →</a>
      <a href="${SITE}" target="_blank" class="muted small">Pricing →</a>
    </div>`);
  const input = $("lic");
  input.focus();
  const submit = async () => {
    $("go").disabled = true; $("err").textContent = "";
    const r = await send("activate", { license_key: input.value.trim() });
    if (r?.error) { $("err").textContent = friendly(r.error); $("go").disabled = false; }
    else render();
  };
  $("go").onclick = submit;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
}

function renderRevoked(s) {
  const expired = s.revoke_reason === "expired";
  h(`${header()}
    <div class="card">
      <div class="row"><strong>${expired ? "Time's up" : "License disabled"}</strong>
        <span class="pill bad">${expired ? "Expired" : "Revoked"}</span></div>
      <p class="muted">${expired ? "Your license has expired. Grab a new one and paste it here." : `Reason: ${escapeHtml(s.revoke_reason ?? "unknown")}.`}</p>
      <a href="${SITE}/dashboard" target="_blank"><button>Get a new key</button></a>
      <div style="height:8px"></div>
      <button id="reset" class="secondary">Sign out</button>
    </div>`);
  $("reset").onclick = async () => { await send("sign_out"); render(); };
}

function renderMain(s) {
  const hasExp = !!s.expires_at;
  const tickHtml = hasExp
    ? `<div class="row" style="margin-top:10px">
         <span class="muted">Time left</span>
         <strong id="countdown" class="mono big">--:--</strong>
       </div>`
    : "";
  h(`${header()}
    <div class="card">
      <div class="row">
        <div>
          <strong>${escapeHtml(s.plan?.name ?? "Plan")}${s.is_trial ? " · Trial" : ""}</strong>
          <div class="muted small">${escapeHtml(s.plan?.code ?? "")}</div>
        </div>
        <span class="pill ok">Active</span>
      </div>
      ${tickHtml}
      <div class="row" style="margin-top:10px">
        <span class="muted">Credits</span>
        <strong>${s.credits ?? "—"}</strong>
      </div>
    </div>
    <div class="card">
      <label for="q">Ask AI</label>
      <textarea id="q" rows="3" placeholder="Summarize this page in 3 bullets…"></textarea>
      <div style="height:8px"></div>
      <button id="run">Send · 1 credit</button>
      <div id="err" class="err"></div>
      <div id="out"></div>
    </div>
    <div class="row">
      <button class="secondary auto" id="signout">Sign out</button>
      <a href="${SITE}/dashboard" target="_blank" class="muted small">Extend →</a>
    </div>`);

  if (hasExp) {
    const tick = () => {
      const left = Math.max(0, Math.floor((s.expires_at - Date.now()) / 1000));
      const el = $("countdown");
      if (!el) return;
      el.textContent = fmt(left);
      el.style.color = left < 60 ? "#ef4444" : left < 300 ? "#f59e0b" : "";
      if (left <= 0) { clearInterval(tickTimer); render(); }
    };
    tick();
    tickTimer = setInterval(tick, 1000);
  }

  $("run").onclick = async () => {
    $("run").disabled = true; $("err").textContent = ""; $("out").innerHTML = "";
    const r = await send("exec", { action: "ai.chat", input: { prompt: $("q").value } });
    $("run").disabled = false;
    if (r?.error) {
      $("err").textContent = friendly(r.error);
      if (r.error === "license_expired") setTimeout(render, 800);
    } else {
      $("out").innerHTML = `<pre class="out">${escapeHtml(r.result?.text ?? JSON.stringify(r.result, null, 2))}</pre>`;
    }
  };
  $("signout").onclick = async () => { await send("sign_out"); render(); };
}

window.addEventListener("error", (e) => {
  console.error("popup error:", e.error ?? e.message);
  try {
    h(`${header()}<div class="card"><strong>Popup error</strong><p class="muted">${escapeHtml(e.message)}</p><button onclick="location.reload()">Reload</button></div>`);
  } catch {}
});

render().catch((e) => {
  console.error(e);
  h(`${header()}<div class="card"><strong>Failed to load</strong><p class="muted">${escapeHtml(String(e))}</p></div>`);
});
