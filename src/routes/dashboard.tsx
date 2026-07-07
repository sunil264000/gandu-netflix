// Dashboard: claim trial, view licenses with live countdown, upgrade plans.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  listPublicPlans, claimTrial, listMyLicenses, createOrder,
} from "@/lib/ext/user.functions";
import { PageBG, Reveal } from "@/components/PageFX";

export const Route = createFileRoute("/dashboard")({ component: Dashboard, ssr: false });

type Plan = { code: string; name: string; price_inr: number; duration_seconds: number; max_devices: number; monthly_credits: number; is_trial: boolean };
type Lic = { id: string; key: string; plan_code: string; status: string; is_trial: boolean; duration_seconds: number; activated_at: string | null; expires_at: string | null; credits_remaining: number; created_at: string };

async function fingerprint(): Promise<string> {
  const parts = [navigator.userAgent, navigator.language, screen.width + "x" + screen.height, screen.colorDepth, new Date().getTimezoneOffset(), navigator.hardwareConcurrency, (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 0];
  try {
    const c = document.createElement("canvas"); c.width = 220; c.height = 40;
    const ctx = c.getContext("2d");
    if (ctx) { ctx.textBaseline = "top"; ctx.font = "14px 'Arial'"; ctx.fillStyle = "#f60"; ctx.fillRect(0, 0, 220, 40); ctx.fillStyle = "#069"; ctx.fillText("AI-Infinity", 2, 2); parts.push(c.toDataURL()); }
  } catch { /* ignore */ }
  const buf = new TextEncoder().encode(parts.join("|"));
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function fmt(sec: number) {
  if (sec <= 0) return "00:00";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function durationLabel(sec: number) {
  if (sec === 900) return "15 minutes";
  if (sec === 86400) return "1 day";
  if (sec % 86400 === 0) return `${sec / 86400} days`;
  return `${Math.round(sec / 60)} min`;
}

function Dashboard() {
  const nav = useNavigate();
  const [email, setEmail] = useState<string | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [licenses, setLicenses] = useState<Lic[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const _plans = useServerFn(listPublicPlans);
  const _list = useServerFn(listMyLicenses);
  const _claim = useServerFn(claimTrial);
  const _order = useServerFn(createOrder);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const refresh = useCallback(async () => {
    const [p, l] = await Promise.all([_plans(), _list()]);
    setPlans(p.plans); setLicenses(l.licenses);
  }, [_plans, _list]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) { nav({ to: "/auth" }); return; }
      setEmail(data.user.email ?? null);
      await refresh();
      setLoading(false);
    })();
  }, [nav, refresh]);

  const trial = licenses.find(l => l.is_trial);
  const paid = licenses.filter(l => !l.is_trial);
  const paidPlans = plans.filter(p => !p.is_trial);

  const doClaim = async () => {
    setClaiming(true); setMsg(null);
    try {
      const fp = await fingerprint();
      const r = await _claim({ data: { fingerprint: fp } });
      if (!r.ok) setMsg(errorText(r.error));
      await refresh();
    } catch (e) { setMsg((e as Error).message); }
    setClaiming(false);
  };

  const doBuy = async (code: string) => {
    setBuying(code); setMsg(null);
    try {
      const r = await _order({ data: { plan_code: code } });
      nav({ to: "/checkout/$orderId", params: { orderId: r.order_id } });
    } catch (e) { setMsg((e as Error).message); setBuying(null); }
  };

  const copy = async (key: string) => { await navigator.clipboard.writeText(key); setCopied(key); setTimeout(() => setCopied(null), 1500); };

  const signOut = async () => { await supabase.auth.signOut(); nav({ to: "/auth" }); };

  if (loading) return <div style={styles.loading}><div style={styles.spinner} /> Loading…</div>;

  return (
    <div style={styles.page}>
      <PageBG />
      <header style={styles.header}>
        <Link to="/" style={styles.logo}><span style={styles.logoMark}/> AI Infinity</Link>
        <div style={styles.headerRight}>
          <span style={styles.email}>{email}</span>
          <button onClick={signOut} style={styles.linkBtn} className="fx-cta">Sign out</button>
        </div>
      </header>

      <main style={styles.main}>
        {msg && <div style={styles.alert}>{msg}</div>}

        <Reveal>
          <section style={styles.section}>
            <h2 style={styles.h2}>Your free trial</h2>
            {!trial ? (
              <div style={styles.card} className="fx-tilt">
                <div style={styles.trialTitle}>15 minutes on us</div>
                <p style={styles.trialSub}>Instant activation. Timer starts the moment you paste the key into the extension — not before.</p>
                <button onClick={doClaim} disabled={claiming} style={styles.primaryBtn} className="fx-cta fx-cta-primary">
                  {claiming ? "Generating…" : "Claim my 15-min key →"}
                </button>
              </div>
            ) : (
              <LicenseCard lic={trial} now={now} onCopy={copy} copied={copied === trial.key} highlight />
            )}
          </section>
        </Reveal>

        <Reveal delay={80}>
          <section style={styles.section}>
            <h2 style={styles.h2}>Upgrade to a paid plan</h2>
            <p style={styles.sub}>Same instant delivery. Countdown starts on first activation in the extension.</p>
            <div style={styles.plansGrid}>
              {paidPlans.map((p, i) => (
                <Reveal key={p.code} delay={i * 60}>
                  <div style={styles.planCard} className="fx-tilt">
                    <div style={styles.planName}>{p.name}</div>
                    <div style={styles.planPrice}><span style={styles.planCurrency}>₹</span>{p.price_inr.toLocaleString("en-IN")}</div>
                    <div style={styles.planMeta}>
                      <div>◷ {durationLabel(p.duration_seconds)}</div>
                      <div>⌘ {p.max_devices} device{p.max_devices > 1 ? "s" : ""}</div>
                      <div>✦ {p.monthly_credits.toLocaleString()} credits</div>
                    </div>
                    <button onClick={() => doBuy(p.code)} disabled={buying === p.code} style={styles.buyBtn} className="fx-cta fx-cta-primary">
                      {buying === p.code ? "Redirecting…" : "Buy now"}
                    </button>
                  </div>
                </Reveal>
              ))}
            </div>
          </section>
        </Reveal>

        {paid.length > 0 && (
          <Reveal delay={100}>
            <section style={styles.section}>
              <h2 style={styles.h2}>Your licenses</h2>
              <div style={styles.licList}>
                {paid.map(l => <LicenseCard key={l.id} lic={l} now={now} onCopy={copy} copied={copied === l.key} />)}
              </div>
            </section>
          </Reveal>
        )}
      </main>
    </div>
  );
}

function LicenseCard({ lic, now, onCopy, copied, highlight }: { lic: Lic; now: number; onCopy: (k: string) => void; copied: boolean; highlight?: boolean }) {
  const activated = !!lic.activated_at;
  const expMs = lic.expires_at ? new Date(lic.expires_at).getTime() : null;
  const remainingSec = expMs ? Math.max(0, Math.floor((expMs - now) / 1000)) : lic.duration_seconds;
  const expired = expMs !== null && remainingSec <= 0;
  const status = expired ? "expired" : !activated ? "not-activated" : "running";
  const pillStyle: React.CSSProperties = { ...styles.pill, background: expired ? "rgba(239,68,68,.15)" : status === "running" ? "rgba(16,185,129,.15)" : "rgba(99,102,241,.15)", color: expired ? "#fca5a5" : status === "running" ? "#6ee7b7" : "#a5b4fc", border: `1px solid ${expired ? "rgba(239,68,68,.3)" : status === "running" ? "rgba(16,185,129,.3)" : "rgba(99,102,241,.3)"}` };

  return (
    <div style={{ ...styles.card, ...(highlight ? styles.cardHi : {}) }} className="fx-tilt">
      <div style={styles.licTop}>
        <div>
          <div style={styles.licPlan}>{lic.plan_code.toUpperCase()}{lic.is_trial ? " · Trial" : ""}</div>
          <div style={styles.licDur}>{durationLabel(lic.duration_seconds)}</div>
        </div>
        <span style={pillStyle}>{status === "running" ? `${fmt(remainingSec)} left` : status === "not-activated" ? "Paste into extension to start" : "Expired"}</span>
      </div>
      <div style={styles.keyRow}>
        <code style={styles.keyText}>{lic.key}</code>
        <button onClick={() => onCopy(lic.key)} style={styles.copyBtn} className="fx-cta">{copied ? "Copied ✓" : "Copy"}</button>
      </div>
      {activated && lic.expires_at && !expired && (
        <div style={styles.licFoot}>Expires {new Date(lic.expires_at).toLocaleString()}</div>
      )}
      {!activated && (
        <div style={styles.licFoot}>Timer starts when you activate the key in the extension.</div>
      )}
    </div>
  );
}

function errorText(e?: string): string {
  switch (e) {
    case "trial_device_used": return "This device already claimed a free trial. Please upgrade to continue.";
    case "trial_ip_used": return "A trial was already claimed from this network. Please upgrade to continue.";
    default: return e ?? "Something went wrong.";
  }
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f8fafc", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: "#0f172a" },
  loading: { minHeight: "100vh", display: "grid", placeItems: "center", color: "#64748b" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 32px", borderBottom: "1px solid #e2e8f0", background: "#fff" },
  logo: { display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 16, color: "#0f172a", textDecoration: "none" },
  logoMark: { width: 24, height: 24, borderRadius: 8, background: "linear-gradient(135deg,#3b82f6,#6366f1)", display: "inline-block" },
  headerRight: { display: "flex", alignItems: "center", gap: 16 },
  email: { fontSize: 13, color: "#64748b" },
  linkBtn: { background: "none", border: "1px solid #e2e8f0", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13 },
  main: { maxWidth: 1080, margin: "0 auto", padding: "40px 32px 80px" },
  section: { marginBottom: 48 },
  h2: { fontSize: 20, fontWeight: 700, margin: "0 0 4px" },
  sub: { color: "#64748b", margin: "0 0 20px", fontSize: 14 },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 24 },
  cardHi: { border: "2px solid #3b82f6", boxShadow: "0 10px 30px -12px rgba(59,130,246,.35)" },
  trialTitle: { fontSize: 22, fontWeight: 700 },
  trialSub: { color: "#64748b", margin: "6px 0 16px", fontSize: 14 },
  primaryBtn: { background: "#0f172a", color: "#fff", border: "none", padding: "12px 22px", borderRadius: 10, fontWeight: 600, cursor: "pointer", fontSize: 14 },
  alert: { background: "#fef3c7", border: "1px solid #fcd34d", color: "#78350f", padding: "12px 16px", borderRadius: 10, marginBottom: 20, fontSize: 14 },
  plansGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 },
  planCard: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, padding: 20, display: "flex", flexDirection: "column" },
  planName: { fontSize: 14, fontWeight: 600, color: "#475569", textTransform: "uppercase", letterSpacing: 0.5 },
  planPrice: { fontSize: 30, fontWeight: 800, margin: "10px 0 4px" },
  planMeta: { color: "#64748b", fontSize: 13, display: "flex", flexDirection: "column", gap: 4, marginBottom: 16 },
  buyBtn: { background: "#3b82f6", color: "#fff", border: "none", padding: "10px 14px", borderRadius: 10, fontWeight: 600, cursor: "pointer", marginTop: "auto" },
  licList: { display: "flex", flexDirection: "column", gap: 12 },
  licTop: { display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 12 },
  licPlan: { fontSize: 12, fontWeight: 700, color: "#475569", letterSpacing: 0.5 },
  licDur: { fontSize: 18, fontWeight: 700, marginTop: 2 },
  pill: { padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600 },
  keyRow: { display: "flex", gap: 8, alignItems: "center", background: "#f1f5f9", padding: 10, borderRadius: 10 },
  keyText: { flex: 1, fontFamily: "'SF Mono', Menlo, monospace", fontSize: 13, wordBreak: "break-all" },
  copyBtn: { background: "#0f172a", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600 },
  licFoot: { marginTop: 12, fontSize: 12, color: "#64748b" },
};
