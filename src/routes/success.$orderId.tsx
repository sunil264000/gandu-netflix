// Success page — shows the generated license key with copy + install instructions.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getOrder } from "@/lib/ext/user.functions";

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

  if (!data) return <div style={s.page}><div style={s.card}>Loading…</div></div>;
  if (!data.license) return <div style={s.page}><div style={s.card}>Order not paid yet.</div></div>;

  const copy = async () => { await navigator.clipboard.writeText(data.license!.key); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.check}>✓</div>
        <h1 style={s.h1}>Payment received</h1>
        <p style={s.sub}>Here's your <strong>{data.plan?.name}</strong> license. The <strong>{fmtDur(data.license.duration_seconds)}</strong> countdown begins the moment you activate this key in the extension.</p>

        <div style={s.keyBox}>
          <code style={s.key}>{data.license.key}</code>
          <button onClick={copy} style={s.copyBtn}>{copied ? "Copied ✓" : "Copy key"}</button>
        </div>

        <div style={s.steps}>
          <div style={s.stepsTitle}>Next steps</div>
          <ol style={s.ol}>
            <li>Download & install the extension (Chrome/Edge/Brave).</li>
            <li>Open the extension popup.</li>
            <li>Paste your license key and press <strong>Activate</strong> — the countdown starts immediately.</li>
          </ol>
        </div>

        <div style={s.actions}>
          <a href="/Lovable-Infinity-Hardened.zip" download style={s.dlBtn}>Download extension</a>
          <Link to="/dashboard" style={s.dashBtn}>Go to dashboard</Link>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "linear-gradient(180deg,#f0f9ff,#f8fafc)", display: "grid", placeItems: "center", padding: 20, fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 20, padding: 40, maxWidth: 560, width: "100%", boxShadow: "0 20px 60px -20px rgba(0,0,0,.15)" },
  check: { width: 56, height: 56, borderRadius: "50%", background: "#dcfce7", color: "#166534", display: "grid", placeItems: "center", fontSize: 30, fontWeight: 700, marginBottom: 20 },
  h1: { fontSize: 28, fontWeight: 800, margin: "0 0 8px" },
  sub: { color: "#475569", margin: "0 0 24px", lineHeight: 1.5, fontSize: 15 },
  keyBox: { background: "#0f172a", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column" as const, gap: 12, marginBottom: 24 },
  key: { color: "#e2e8f0", fontFamily: "'SF Mono', Menlo, monospace", fontSize: 15, wordBreak: "break-all" as const },
  copyBtn: { background: "#3b82f6", color: "#fff", border: "none", padding: "10px", borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 14 },
  steps: { background: "#f8fafc", borderRadius: 12, padding: "16px 20px", marginBottom: 20 },
  stepsTitle: { fontSize: 13, fontWeight: 700, color: "#475569", marginBottom: 8, textTransform: "uppercase" as const, letterSpacing: 0.5 },
  ol: { margin: 0, paddingLeft: 20, fontSize: 14, color: "#334155", lineHeight: 1.8 },
  actions: { display: "flex", gap: 10 },
  dlBtn: { flex: 1, background: "#0f172a", color: "#fff", padding: "12px", borderRadius: 10, fontWeight: 600, textDecoration: "none", textAlign: "center" as const, fontSize: 14 },
  dashBtn: { flex: 1, background: "#fff", color: "#0f172a", padding: "12px", borderRadius: 10, fontWeight: 600, textDecoration: "none", textAlign: "center" as const, fontSize: 14, border: "1px solid #e2e8f0" },
};
