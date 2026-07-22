// Sign-in page — Google + email/password (no signup once owner claimed).
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { PageBG } from "@/components/PageFX";

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
      if (data.user) nav({ to: "/" });
    });
  }, [nav]);

  const google = async () => {
    setBusy(true); setErr("");
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (r.error) { setErr(String(r.error.message ?? r.error)); setBusy(false); return; }
    nav({ to: "/" });
  };

  const emailSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr("");
    const fn = mode === "signin" ? supabase.auth.signInWithPassword({ email, password: pw })
                                  : supabase.auth.signUp({ email, password: pw, options: { emailRedirectTo: window.location.origin + "/auth" } });
    const { error } = await fn;
    setBusy(false);
    if (error) return setErr(error.message);
    nav({ to: "/" });
  };

  return (
    <div style={s.page}>
      <PageBG />
      <Link to="/" style={s.back}>← Back</Link>
      <div style={s.card} className="fx-tilt">
        <div style={s.brand}>
          <span style={s.mark} />
          <div>
            <h1 style={s.title}>AI Infinity</h1>
            <div style={s.sub}>{mode === "signin" ? "Welcome back" : "Create your account"}</div>
          </div>
        </div>

        <button onClick={google} disabled={busy} style={s.google} className="fx-cta">
          <GoogleIcon /> Continue with Google
        </button>

        <div style={s.divider}>
          <span style={s.line} /><span style={s.or}>OR</span><span style={s.line} />
        </div>

        <form onSubmit={emailSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={s.input} className="fx-input" />
          <input type="password" required minLength={8} placeholder="Password (min 8 chars)" value={pw} onChange={(e) => setPw(e.target.value)} style={s.input} className="fx-input" />
          <button type="submit" disabled={busy} style={s.primary} className="fx-cta fx-cta-primary">
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div style={s.switch}>
          {mode === "signin"
            ? <>New here? <a href="#" onClick={(e) => { e.preventDefault(); setMode("signup"); }} style={s.link}>Create account</a></>
            : <>Have an account? <a href="#" onClick={(e) => { e.preventDefault(); setMode("signin"); }} style={s.link}>Sign in</a></>}
        </div>

        {err && <div style={s.err}>{err}</div>}
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" style={{ flexShrink: 0 }}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#07070c", color: "#e5e7eb", padding: 20, fontFamily: "-apple-system,BlinkMacSystemFont,Segoe UI,system-ui,sans-serif", position: "relative", overflow: "hidden" },
  back: { position: "absolute", top: 24, left: 24, color: "#94a3b8", textDecoration: "none", fontSize: 14, zIndex: 2, padding: "6px 12px", borderRadius: 8, transition: "color .2s ease, background .2s ease" },
  card: { position: "relative", zIndex: 1, width: "100%", maxWidth: 420, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 20, padding: 32, backdropFilter: "blur(14px)", boxShadow: "0 30px 80px -20px rgba(0,0,0,.5)" },
  brand: { display: "flex", alignItems: "center", gap: 14, marginBottom: 24 },
  mark: { width: 42, height: 42, borderRadius: 12, background: "linear-gradient(135deg,#3b82f6,#a855f7,#ec4899)", boxShadow: "0 0 24px rgba(168,85,247,.5)" },
  title: { margin: 0, fontSize: 22, fontWeight: 700, color: "#fff" },
  sub: { fontSize: 13, color: "#94a3b8", marginTop: 2 },
  google: { width: "100%", padding: "11px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,.12)", background: "rgba(255,255,255,.05)", color: "#fff", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, fontSize: 14 },
  divider: { display: "flex", alignItems: "center", gap: 12, margin: "20px 0" },
  line: { flex: 1, height: 1, background: "rgba(255,255,255,.08)" },
  or: { fontSize: 11, color: "#64748b", fontWeight: 600, letterSpacing: 1 },
  input: { width: "100%", padding: "12px 14px", borderRadius: 10, border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.03)", color: "#fff", font: "inherit", outline: "none" },
  primary: { width: "100%", padding: "12px 14px", borderRadius: 10, border: 0, background: "linear-gradient(135deg,#3b82f6,#6366f1,#a855f7)", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 14, boxShadow: "0 12px 30px -10px rgba(99,102,241,.6)", marginTop: 4 },
  switch: { textAlign: "center", marginTop: 20, fontSize: 13, color: "#94a3b8" },
  link: { color: "#93c5fd", textDecoration: "none", fontWeight: 600 },
  err: { color: "#fca5a5", marginTop: 14, fontSize: 13, textAlign: "center", background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.25)", padding: "10px", borderRadius: 8 },
};
