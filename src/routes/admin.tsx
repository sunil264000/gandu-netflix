import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  isOwner, claimOwner, listPlans, listLicenses, createLicense,
  setLicenseStatus, killLicense, unkillLicense, adjustCredits,
} from "@/lib/ext/admin.functions";

export const Route = createFileRoute("/admin")({ component: AdminPage, ssr: false });

type Lic = { id: string; key: string; plan_code: string; status: string; credits_remaining: number; notes: string | null; created_at: string };
type Plan = { code: string; name: string; max_devices: number; monthly_credits: number; price_inr: number };

function AdminPage() {
  const nav = useNavigate();
  const [userEmail, setEmail] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "signin" | "claim" | "locked" | "ready">("loading");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [lics, setLics] = useState<Lic[]>([]);
  const [newPlan, setNewPlan] = useState("free");
  const [notes, setNotes] = useState("");
  const [msg, setMsg] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const _isOwner = useServerFn(isOwner);
  const _claimOwner = useServerFn(claimOwner);
  const _listPlans = useServerFn(listPlans);
  const _listLicenses = useServerFn(listLicenses);
  const _createLicense = useServerFn(createLicense);
  const _setStatus = useServerFn(setLicenseStatus);
  const _kill = useServerFn(killLicense);
  const _unkill = useServerFn(unkillLicense);
  const _adjust = useServerFn(adjustCredits);

  const load = useCallback(async () => {
    const [p, l] = await Promise.all([_listPlans(), _listLicenses()]);
    setPlans(p.plans); setLics(l.licenses);
    setState("ready");
  }, [_listPlans, _listLicenses]);

  const boot = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) { setState("signin"); return; }
    setEmail(data.user.email ?? null);
    const s = await _isOwner();
    if (s.isAdmin) return load();
    if (s.anyAdminExists) { setState("locked"); return; }
    setState("claim");
  }, [_isOwner, load]);

  useEffect(() => { boot(); }, [boot]);

  const claim = async () => {
    try { await _claimOwner(); await boot(); }
    catch (e) { setMsg(String((e as Error).message)); }
  };

  const signOut = async () => { await supabase.auth.signOut(); nav({ to: "/auth" }); };

  const create = async () => {
    setMsg("");
    try { await _createLicense({ data: { plan_code: newPlan, notes: notes || undefined } }); setNotes(""); load(); }
    catch (e) { setMsg(String((e as Error).message)); }
  };

  const copy = async (k: string) => { await navigator.clipboard.writeText(k); setCopiedKey(k); setTimeout(() => setCopiedKey(null), 1200); };

  if (state === "loading") return <div style={wrap}><div style={card}>Loading…</div></div>;

  if (state === "signin") {
    return <div style={wrap}><div style={card}>
      <h1 style={h1}>Owner console</h1>
      <p style={muted}>Sign in to continue.</p>
      <button style={btn} onClick={() => nav({ to: "/auth" })}>Go to sign in</button>
    </div></div>;
  }

  if (state === "claim") {
    return <div style={wrap}><div style={card}>
      <h1 style={h1}>Claim owner access</h1>
      <p style={muted}>No owner has been set yet. Click below to lock this account as the permanent owner ({userEmail}).</p>
      <button style={btn} onClick={claim}>Claim owner · irreversible</button>
      {msg && <div style={{ color: "#ef4444", marginTop: 10 }}>{msg}</div>}
      <button style={{ ...btn, background: "#fff", color: "#0f172a", border: "1px solid #e5e7eb", marginTop: 10 }} onClick={signOut}>Sign out</button>
    </div></div>;
  }

  if (state === "locked") {
    return <div style={wrap}><div style={card}>
      <h1 style={h1}>Access denied</h1>
      <p style={muted}>Another account owns this workspace. Signed in as {userEmail}.</p>
      <button style={btn} onClick={signOut}>Sign out</button>
    </div></div>;
  }

  return (
    <div style={wrap}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={h1}>AI Infinity — Owner</h1>
          <div style={{ fontSize: 12, color: "#64748b" }}>{userEmail}</div>
        </div>
        <button style={{ ...btn, width: "auto", background: "#fff", color: "#0f172a", border: "1px solid #e5e7eb" }} onClick={signOut}>Sign out</button>
      </div>

      <div style={card}>
        <h2 style={h2}>Create license</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <select value={newPlan} onChange={(e) => setNewPlan(e.target.value)} style={{ ...input, flex: "0 0 220px" }}>
            {plans.map((p) => <option key={p.code} value={p.code}>{p.name} · {p.monthly_credits} cr · ×{p.max_devices} devices</option>)}
          </select>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} style={{ ...input, flex: 1, minWidth: 200 }} placeholder="Customer email / order id / notes" />
          <button style={{ ...btn, width: 140 }} onClick={create}>Create</button>
        </div>
        {msg && <div style={{ color: "#ef4444", marginTop: 10 }}>{msg}</div>}
      </div>

      <div style={{ ...card, marginTop: 20 }}>
        <h2 style={h2}>Licenses ({lics.length})</h2>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#64748b" }}>
              <th style={th}>Key</th><th style={th}>Plan</th><th style={th}>Status</th>
              <th style={th}>Credits</th><th style={th}>Notes</th><th style={th}>Created</th><th style={th}></th>
            </tr>
          </thead>
          <tbody>
            {lics.map((l) => (
              <tr key={l.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                <td style={td}>
                  <button onClick={() => copy(l.key)} style={{ background: "none", border: 0, cursor: "pointer", padding: 0, font: "inherit", color: "#0f172a" }}>
                    <code>{l.key}</code> {copiedKey === l.key ? "✓" : "📋"}
                  </button>
                </td>
                <td style={td}>{l.plan_code}</td>
                <td style={td}><span style={pill(l.status === "active" ? "#10b981" : "#ef4444")}>{l.status}</span></td>
                <td style={td}>
                  <input type="number" defaultValue={l.credits_remaining} style={{ ...input, width: 90, padding: "4px 8px" }}
                    onBlur={async (e) => {
                      const v = Number(e.target.value);
                      if (v !== l.credits_remaining) { await _adjust({ data: { license_id: l.id, credits: v } }); load(); }
                    }} />
                </td>
                <td style={td}>{l.notes ?? "—"}</td>
                <td style={td}>{new Date(l.created_at).toLocaleDateString()}</td>
                <td style={{ ...td, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {l.status === "active"
                    ? <button style={miniBtn("#ef4444")} onClick={async () => { await _setStatus({ data: { license_id: l.id, status: "revoked" } }); load(); }}>Revoke</button>
                    : <button style={miniBtn("#10b981")} onClick={async () => { await _setStatus({ data: { license_id: l.id, status: "active" } }); load(); }}>Restore</button>}
                  <button style={miniBtn("#0f172a")} onClick={async () => { await _kill({ data: { license_id: l.id, reason: "admin" } }); load(); }}>Kill</button>
                  <button style={miniBtn("#64748b")} onClick={async () => { await _unkill({ data: { license_id: l.id } }); load(); }}>Unkill</button>
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
const input: React.CSSProperties = { padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", font: "inherit", outline: "none" };
const btn: React.CSSProperties = { width: "100%", padding: "10px 14px", borderRadius: 10, border: 0, background: "linear-gradient(135deg,#3b82f6,#6366f1)", color: "#fff", fontWeight: 600, cursor: "pointer" };
const th: React.CSSProperties = { padding: "8px 6px", fontWeight: 500, fontSize: 12 };
const td: React.CSSProperties = { padding: "10px 6px", verticalAlign: "middle" };
const pill = (c: string): React.CSSProperties => ({ background: c + "22", color: c, padding: "2px 8px", borderRadius: 999, fontSize: 11, fontWeight: 600 });
const miniBtn = (c: string): React.CSSProperties => ({ padding: "4px 8px", borderRadius: 8, border: `1px solid ${c}33`, background: "#fff", color: c, fontSize: 12, cursor: "pointer" });
