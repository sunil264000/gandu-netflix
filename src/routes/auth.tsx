// Sign-in page — Google + email/password (no signup once owner claimed).
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

export const Route = createFileRoute("/auth")({ component: Auth, ssr: false });

function Auth() {
  const nav = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) nav({ to: "/dashboard" });
    });
  }, [nav]);

  const google = async () => {
    setBusy(true); setErr("");
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (r.error) { setErr(String(r.error.message ?? r.error)); setBusy(false); return; }
    // signInWithOAuth navigates away in full-page flow; if we reach here, session is set
    nav({ to: "/dashboard" });
  };

  const emailSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    const fn = mode === "signin" ? supabase.auth.signInWithPassword({ email, password: pw })
                                  : supabase.auth.signUp({ email, password: pw, options: { emailRedirectTo: window.location.origin + "/auth" } });
    const { error } = await fn;
    setBusy(false);
    if (error) return setErr(error.message);
    nav({ to: "/dashboard" });
  };

  return (
    <div style={wrap}>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ width: 40, height: 40, borderRadius: 12, background: "linear-gradient(135deg,#3b82f6,#6366f1)" }} />
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Lovable Infinity</h1>
            <div style={{ fontSize: 12, color: "#64748b" }}>Owner console</div>
          </div>
        </div>

        <button onClick={google} disabled={busy} style={{ ...btn, background: "#fff", color: "#0f172a", border: "1px solid #e5e7eb", marginBottom: 14 }}>
          Continue with Google
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "8px 0 14px", color: "#94a3b8", fontSize: 12 }}>
          <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} /> OR <div style={{ flex: 1, height: 1, background: "#e5e7eb" }} />
        </div>

        <form onSubmit={emailSubmit}>
          <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} style={input} />
          <div style={{ height: 10 }} />
          <input type="password" required minLength={8} placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} style={input} />
          <div style={{ height: 12 }} />
          <button type="submit" disabled={busy} style={btn}>{mode === "signin" ? "Sign in" : "Create account"}</button>
        </form>

        <div style={{ textAlign: "center", marginTop: 14, fontSize: 13 }}>
          {mode === "signin"
            ? <>New here? <a href="#" onClick={(e) => { e.preventDefault(); setMode("signup"); }} style={link}>Create account</a></>
            : <>Have an account? <a href="#" onClick={(e) => { e.preventDefault(); setMode("signin"); }} style={link}>Sign in</a></>}
        </div>

        {err && <div style={{ color: "#ef4444", marginTop: 12, fontSize: 13, textAlign: "center" }}>{err}</div>}
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#fafbfc", padding: 20, fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,system-ui,sans-serif", color: "#0f172a" };
const card: React.CSSProperties = { width: "100%", maxWidth: 380, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, padding: 28, boxShadow: "0 10px 40px rgba(15,23,42,0.06)" };
const input: React.CSSProperties = { width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb", background: "#fff", font: "inherit", outline: "none" };
const btn: React.CSSProperties = { width: "100%", padding: "10px 14px", borderRadius: 10, border: 0, background: "linear-gradient(135deg,#3b82f6,#6366f1)", color: "#fff", fontWeight: 600, cursor: "pointer" };
const link: React.CSSProperties = { color: "#3b82f6", textDecoration: "none", fontWeight: 500 };
