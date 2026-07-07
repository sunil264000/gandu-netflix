// Minimal Cloud-White admin console for the extension backend.
// Auth: paste the admin bootstrap token (stored in localStorage for this browser only).
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/admin")({ component: AdminPage, ssr: false });

type Lic = {
  id: string; key: string; plan_code: string; status: string;
  credits_remaining: number; credits_reset_at: string; notes: string | null; created_at: string;
};
type Plan = { code: string; name: string; max_devices: number; monthly_credits: number; price_inr: number };

async function api(token: string, action: string, extra: Record<string, unknown> = {}) {
  const r = await fetch("/api/public/ext/admin", {
    method: "POST",
    headers: { "content-type": "application/json", "x-admin-token": token },
    body: JSON.stringify({ action, ...extra }),
  });
  return r.json();
}

function AdminPage() {
  const [token, setToken] = useState<string>("");
  const [ok, setOk] = useState(false);
  const [licenses, setLicenses] = useState<Lic[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [newPlan, setNewPlan] = useState("free");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => { setToken(localStorage.getItem("adm_tok") ?? ""); }, []);

  const refresh = async (tk: string) => {
    const [l, p] = await Promise.all([api(tk, "list_licenses"), api(tk, "list_plans")]);
    if (l.error) { setMsg(l.error); setOk(false); return; }
    setLicenses(l.licenses ?? []);
    setPlans(p.plans ?? []);
    setOk(true); setMsg("");
    localStorage.setItem("adm_tok", tk);
  };

  const create = async () => {
    const r = await api(token, "create_license", { plan_code: newPlan, notes });
    if (r.error) return setMsg(r.error);
    setNotes(""); refresh(token);
  };

  const revoke = async (id: string) => { await api(token, "revoke_license", { license_id: id }); refresh(token); };
  const unrevoke = async (id: string) => { await api(token, "unrevoke_license", { license_id: id }); refresh(token); };
  const kill = async (id: string) => { await api(token, "kill_license", { license_id: id, reason: "admin" }); refresh(token); };
  const unkill = async (id: string) => { await api(token, "unkill_license", { license_id: id }); refresh(token); };

  if (!ok) {
    return (
      <div style={wrap}>
        <div style={card}>
          <h1 style={h1}>Admin console</h1>
          <p style={muted}>Paste the admin bootstrap token (EXT_MASTER_SECRET) to continue.</p>
          <input value={token} onChange={(e) => setToken(e.target.value)} style={input} placeholder="Admin token" type="password" />
          <button style={btn} onClick={() => refresh(token)}>Continue</button>
          {msg && <div style={{ color: "#ef4444", marginTop: 8 }}>{msg}</div>}
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <h1 style={h1}>Lovable Infinity — Admin</h1>
        <button style={{ ...btn, background: "#fff", color: "#0f172a", border: "1px solid #e5e7eb" }}
          onClick={() => { localStorage.removeItem("adm_tok"); location.reload(); }}>Sign out</button>
      </div>

      <div style={card}>
        <h2 style={h2}>Create license</h2>
        <div style={{ display: "flex", gap: 10 }}>
          <select value={newPlan} onChange={(e) => setNewPlan(e.target.value)} style={{ ...input, flex: "0 0 160px" }}>
            {plans.map((p) => <option key={p.code} value={p.code}>{p.name} · {p.monthly_credits} cr · ×{p.max_devices}</option>)}
          </select>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...input, flex: 1 }} placeholder="Notes (customer email, order id)…" />
          <button style={{ ...btn, width: 140 }} onClick={create}>Create</button>
        </div>
      </div>

      <div style={{ ...card, marginTop: 20 }}>
        <h2 style={h2}>Licenses ({licenses.length})</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#64748b" }}>
              <th style={th}>Key</th><th style={th}>Plan</th><th style={th}>Status</th>
              <th style={th}>Credits</th><th style={th}>Notes</th><th style={th}>Created</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {licenses.map((l) => (
              <tr key={l.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                <td style={td}><code>{l.key}</code></td>
                <td style={td}>{l.plan_code}</td>
                <td style={td}><span style={pill(l.status === "active" ? "#10b981" : "#ef4444")}>{l.status}</span></td>
                <td style={td}>{l.credits_remaining}</td>
                <td style={td}>{l.notes ?? "—"}</td>
                <td style={td}>{new Date(l.created_at).toLocaleDateString()}</td>
                <td style={{ ...td, display: "flex", gap: 6 }}>
                  {l.status === "active"
                    ? <button style={miniBtn("#ef4444")} onClick={() => revoke(l.id)}>Revoke</button>
                    : <button style={miniBtn("#10b981")} onClick={() => unrevoke(l.id)}>Restore</button>}
                  <button style={miniBtn("#0f172a")} onClick={() => kill(l.id)}>Kill</button>
                  <button style={miniBtn("#64748b")} onClick={() => unkill(l.id)}>Unkill</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = { minHeight: "100vh", background: "#fafbfc", padding: 32, color: "#0f172a", fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,system-ui,sans-serif" };
const card: React.CSSProperties = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 20, boxShadow: "0 4px 20px rgba(15,23,42,0.06)", maxWidth: 1100, margin: "0 auto" };
const h1: React.CSSProperties = { margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" };
const h2: React.CSSProperties = { margin: "0 0 12px", fontSize: 15, fontWeight: 600 };
const muted: React.CSSProperties = { color: "#64748b", fontSize: 13, margin: "4px 0 14px" };
const input: React.CSSProperties = { padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", font: "inherit", outline: "none", width: "100%" };
const btn: React.CSSProperties = { padding: "10px 14px", borderRadius: 10, border: 0, background: "linear-gradient(135deg,#3b82f6,#6366f1)", color: "#fff", fontWeight: 600, cursor: "pointer", marginTop: 10 };
const th: React.CSSProperties = { padding: "8px 6px", fontWeight: 500, fontSize: 12 };
const td: React.CSSProperties = { padding: "10px 6px", verticalAlign: "middle" };
const pill = (c: string): React.CSSProperties => ({ background: c + "22", color: c, padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600 });
const miniBtn = (c: string): React.CSSProperties => ({ padding: "4px 8px", borderRadius: 8, border: `1px solid ${c}33`, background: "#fff", color: c, fontSize: 12, cursor: "pointer" });
