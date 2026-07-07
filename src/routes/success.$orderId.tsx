// Success page — shows the generated license key with copy + install instructions.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getOrder } from "@/lib/ext/user.functions";
import { PageBG, Reveal } from "@/components/PageFX";

export const Route = createFileRoute("/success/$orderId")({ component: Success, ssr: false });

function fmtDur(sec: number) {
  if (sec % 86400 === 0) return `${sec / 86400} days`;
  if (sec === 900) return "15 minutes";
  return `${Math.round(sec / 3600)} hours`;
}

function Success() {
  const { orderId } = Route.useParams();
  const nav = useNavigate();
  const [data, setData] = useState<{ license: { key: string; duration_seconds: number } | null; plan: { name: string } | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const _get = useServerFn(getOrder);

  const load = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { nav({ to: "/auth" }); return; }
    const r = await _get({ data: { order_id: orderId } });
    setData(r);
  }, [_get, orderId, nav]);

  useEffect(() => { load(); }, [load]);

  const copy = async () => { await navigator.clipboard.writeText(data!.license!.key); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <div style={s.page}>
      <PageBG />
      {!data ? (
        <div style={s.card}><div style={s.loading}><div style={s.spinner} /> Loading…</div></div>
      ) : !data.license ? (
        <div style={s.card}><h1 style={s.h1}>Order not paid yet</h1></div>
      ) : (
        <Reveal>
          <div style={s.card} className="fx-glow">
            <div style={s.check}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h1 style={s.h1}>Payment received</h1>
            <p style={s.sub}>Here's your <strong style={s.strong}>{data.plan?.name}</strong> license. The <strong style={s.strong}>{fmtDur(data.license.duration_seconds)}</strong> countdown starts the moment you activate this key in the extension.</p>

            <div style={s.keyBox}>
              <div style={s.keyLabel}>YOUR LICENSE KEY</div>
              <code style={s.key}>{data.license.key}</code>
              <button onClick={copy} style={s.copyBtn} className="fx-cta fx-cta-primary">{copied ? "Copied ✓" : "Copy key"}</button>
            </div>

            <div style={s.steps}>
              <div style={s.stepsTitle}>Next steps</div>
              <ol style={s.ol}>
                <li>Download & install the extension (Chrome/Edge/Brave).</li>
                <li>Open the extension popup.</li>
                <li>Paste your license key and press <strong style={s.strong}>Activate</strong> — the countdown starts immediately.</li>
              </ol>
            </div>

            <div style={s.actions}>
              <a href="/AI-Infinity-Hardened.zip" download style={s.dlBtn} className="fx-cta fx-cta-primary">↓ Download extension</a>
              <Link to="/dashboard" style={s.dashBtn} className="fx-cta">Go to dashboard</Link>
            </div>
          </div>
        </Reveal>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#07070c", color: "#e5e7eb", display: "grid", placeItems: "center", padding: 20, fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", position: "relative", overflow: "hidden" },
  card: { position: "relative", zIndex: 1, background: "rgba(255,255,255,.03)", border: "1px solid rgba(99,102,241,.25)", borderRadius: 24, padding: 40, maxWidth: 580, width: "100%", backdropFilter: "blur(14px)" },
  loading: { display: "flex", alignItems: "center", gap: 12, color: "#94a3b8" },
  spinner: { width: 18, height: 18, border: "2px solid rgba(255,255,255,.15)", borderTopColor: "#a855f7", borderRadius: "50%", animation: "fx-spin 0.8s linear infinite" },
  check: { width: 64, height: 64, borderRadius: "50%", background: "linear-gradient(135deg, rgba(16,185,129,.2), rgba(16,185,129,.05))", border: "1px solid rgba(16,185,129,.4)", color: "#10b981", display: "grid", placeItems: "center", marginBottom: 22, boxShadow: "0 0 30px rgba(16,185,129,.3)" },
  h1: { fontSize: 30, fontWeight: 800, margin: "0 0 10px", color: "#fff", letterSpacing: -0.5 },
  sub: { color: "#94a3b8", margin: "0 0 24px", lineHeight: 1.6, fontSize: 15 },
  strong: { color: "#fff" },
  keyBox: { background: "linear-gradient(180deg, rgba(15,23,42,.6), rgba(15,23,42,.3))", border: "1px solid rgba(255,255,255,.08)", borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 12, marginBottom: 24 },
  keyLabel: { fontSize: 10, color: "#64748b", fontWeight: 700, letterSpacing: 1.5 },
  key: { color: "#93c5fd", fontFamily: "'SF Mono', Menlo, monospace", fontSize: 15, wordBreak: "break-all" },
  copyBtn: { background: "linear-gradient(135deg,#3b82f6,#6366f1)", color: "#fff", border: "none", padding: "11px", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 14 },
  steps: { background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.05)", borderRadius: 12, padding: "18px 22px", marginBottom: 22 },
  stepsTitle: { fontSize: 11, fontWeight: 700, color: "#93c5fd", marginBottom: 10, textTransform: "uppercase", letterSpacing: 1.5 },
  ol: { margin: 0, paddingLeft: 20, fontSize: 14, color: "#cbd5e1", lineHeight: 1.9 },
  actions: { display: "flex", gap: 10 },
  dlBtn: { flex: 1, background: "linear-gradient(135deg,#3b82f6,#a855f7)", color: "#fff", padding: "13px", borderRadius: 10, fontWeight: 700, textDecoration: "none", textAlign: "center", fontSize: 14, boxShadow: "0 15px 35px -10px rgba(99,102,241,.5)" },
  dashBtn: { flex: 1, background: "rgba(255,255,255,.04)", color: "#fff", padding: "13px", borderRadius: 10, fontWeight: 600, textDecoration: "none", textAlign: "center", fontSize: 14, border: "1px solid rgba(255,255,255,.12)" },
};
