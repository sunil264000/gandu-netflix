const $ = (id) => document.getElementById(id);
const app = document.getElementById("app");

function h(html) { app.innerHTML = html; }
function send(type, data = {}) { return new Promise((r) => chrome.runtime.sendMessage({ type, ...data }, r)); }

async function render() {
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
      <div class="hint">Your key binds to this device. Contact support to reset.</div>
    </div>`);
  $("go").onclick = async () => {
    $("go").disabled = true; $("err").textContent = "";
    const r = await send("activate", { license_key: $("lic").value.trim() });
    if (r?.error) { $("err").textContent = r.error; $("go").disabled = false; }
    else render();
  };
}

function renderRevoked(s) {
  h(`${header()}
    <div class="card">
      <div class="row"><strong>License disabled</strong><span class="pill bad">Revoked</span></div>
      <p class="muted">Reason: ${s.revoke_reason ?? "unknown"}. Contact support to restore access.</p>
      <button id="reset" class="secondary">Sign out</button>
    </div>`);
  $("reset").onclick = async () => { await send("sign_out"); render(); };
}

function renderMain(s) {
  h(`${header()}
    <div class="card">
      <div class="row">
        <div><strong>${s.plan?.name ?? "Plan"}</strong><div class="muted">${s.plan?.code ?? ""}</div></div>
        <span class="pill ok">Active</span>
      </div>
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
      <span class="muted">Kill-switch · 60s</span>
    </div>`);
  $("run").onclick = async () => {
    $("run").disabled = true; $("err").textContent = ""; $("out").innerHTML = "";
    const r = await send("exec", { action: "ai.chat", input: { prompt: $("q").value } });
    $("run").disabled = false;
    if (r?.error) $("err").textContent = r.error;
    else {
      $("out").innerHTML = `<pre class="out">${escapeHtml(r.result?.text ?? JSON.stringify(r.result))}</pre>`;
      render();
    }
  };
  $("signout").onclick = async () => { await send("sign_out"); render(); };
}

function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

render();
