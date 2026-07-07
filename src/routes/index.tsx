// Landing page — Lovable Infinity marketing site.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "Lovable Infinity — Unlimited AI credits, on any project" },
      { name: "description", content: "Extension that gives you unlimited Lovable AI credits. Start with a 15-minute free trial, upgrade to daily / weekly / monthly plans. Countdown starts on first activation." },
      { property: "og:title", content: "Lovable Infinity — Unlimited AI, unlimited creativity" },
      { property: "og:description", content: "15-min free trial. Then day/week/month/year plans starting at ₹150." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const plans = [
  { code: "day", name: "Day Pass", price: 150, dur: "1 day" },
  { code: "week", name: "Weekly", price: 899, dur: "7 days" },
  { code: "month", name: "Monthly", price: 2999, dur: "30 days", pop: true },
  { code: "quarter", name: "Quarterly", price: 7499, dur: "90 days" },
  { code: "halfyear", name: "Half-Year", price: 12999, dur: "180 days" },
  { code: "year", name: "Yearly", price: 20000, dur: "365 days" },
];

function Landing() {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user)); }, []);

  return (
    <div style={s.page}>
      <header style={s.nav}>
        <Link to="/" style={s.logo}><span style={s.logoMark}/> Lovable Infinity</Link>
        <nav style={s.navRight}>
          <a href="#pricing" style={s.navLink}>Pricing</a>
          <a href="#how" style={s.navLink}>How it works</a>
          {signedIn
            ? <Link to="/dashboard" style={s.navCTA}>Dashboard</Link>
            : <Link to="/auth" style={s.navCTA}>Sign in</Link>}
        </nav>
      </header>

      <section style={s.hero}>
        <div style={s.badge}>Now with 15-minute instant free trial</div>
        <h1 style={s.h1}>Unlimited Lovable AI.<br/><span style={s.gradient}>Zero limits.</span></h1>
        <p style={s.heroSub}>A hardened Chrome extension that unlocks unlimited Lovable AI credits on any project. Instant activation. Real device-locked keys. Kill-switch protected.</p>
        <div style={s.heroCTAs}>
          <Link to={signedIn ? "/dashboard" : "/auth"} style={s.primaryCTA}>Start free — 15 minutes</Link>
          <a href="#pricing" style={s.secondaryCTA}>See plans</a>
        </div>
        <div style={s.trust}>No card required · Trial starts on activation · Cancel anytime</div>
      </section>

      <section id="how" style={s.section}>
        <h2 style={s.h2}>How it works</h2>
        <div style={s.steps}>
          {[
            { n: "1", t: "Sign in", d: "Google or email. One click." },
            { n: "2", t: "Get your key", d: "Free 15-min trial issued instantly. Or buy a plan." },
            { n: "3", t: "Paste & go", d: "Countdown starts the moment you activate in the extension — never a second before." },
          ].map(x => (
            <div key={x.n} style={s.step}>
              <div style={s.stepN}>{x.n}</div>
              <div style={s.stepT}>{x.t}</div>
              <div style={s.stepD}>{x.d}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" style={s.section}>
        <h2 style={s.h2}>Simple pricing</h2>
        <p style={s.sectionSub}>Pay for time, not usage. All plans deliver instantly.</p>
        <div style={s.grid}>
          {plans.map(p => (
            <div key={p.code} style={{ ...s.card, ...(p.pop ? s.cardPop : {}) }}>
              {p.pop && <div style={s.popBadge}>Most popular</div>}
              <div style={s.cardName}>{p.name}</div>
              <div style={s.cardPrice}>₹{p.price.toLocaleString("en-IN")}</div>
              <div style={s.cardDur}>{p.dur}</div>
              <Link to={signedIn ? "/dashboard" : "/auth"} style={s.cardBtn}>Choose {p.name}</Link>
            </div>
          ))}
        </div>
      </section>

      <section style={s.section}>
        <h2 style={s.h2}>Why Lovable Infinity</h2>
        <div style={s.feats}>
          {[
            { t: "Hardware-locked", d: "Every key binds to your device fingerprint. Nobody else can use it — even if leaked." },
            { t: "Countdown on activation", d: "Buy today, activate next week. Timer only starts on first activation." },
            { t: "Server-authoritative", d: "5-minute JWT sessions, 60s replay protection, HMAC-signed on every request." },
            { t: "Kill-switch protected", d: "Instant revocation across all devices in <60 seconds if a key is misused." },
          ].map(f => (
            <div key={f.t} style={s.feat}>
              <div style={s.featT}>{f.t}</div>
              <div style={s.featD}>{f.d}</div>
            </div>
          ))}
        </div>
      </section>

      <footer style={s.footer}>
        <div>© {new Date().getFullYear()} Lovable Infinity</div>
        <div><Link to="/admin" style={s.footerLink}>Admin</Link></div>
      </footer>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#0a0a0f", color: "#e5e7eb", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  nav: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 40px", borderBottom: "1px solid rgba(255,255,255,.06)", position: "sticky", top: 0, background: "rgba(10,10,15,.85)", backdropFilter: "blur(12px)", zIndex: 10 },
  logo: { display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 16, color: "#fff", textDecoration: "none" },
  logoMark: { width: 24, height: 24, borderRadius: 8, background: "linear-gradient(135deg,#3b82f6,#a855f7)" },
  navRight: { display: "flex", gap: 24, alignItems: "center" },
  navLink: { color: "#94a3b8", textDecoration: "none", fontSize: 14 },
  navCTA: { background: "#fff", color: "#0a0a0f", padding: "8px 18px", borderRadius: 8, textDecoration: "none", fontSize: 14, fontWeight: 600 },
  hero: { maxWidth: 900, margin: "0 auto", padding: "100px 24px 80px", textAlign: "center" as const },
  badge: { display: "inline-block", background: "rgba(59,130,246,.15)", color: "#93c5fd", padding: "6px 14px", borderRadius: 999, fontSize: 12, fontWeight: 600, marginBottom: 24 },
  h1: { fontSize: 72, fontWeight: 800, lineHeight: 1.05, margin: "0 0 24px", letterSpacing: -1.5 },
  gradient: { background: "linear-gradient(135deg,#3b82f6,#a855f7,#ec4899)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" },
  heroSub: { fontSize: 20, color: "#94a3b8", maxWidth: 640, margin: "0 auto 36px", lineHeight: 1.5 },
  heroCTAs: { display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" as const },
  primaryCTA: { background: "linear-gradient(135deg,#3b82f6,#6366f1)", color: "#fff", padding: "16px 32px", borderRadius: 12, textDecoration: "none", fontWeight: 700, fontSize: 16, boxShadow: "0 20px 40px -12px rgba(59,130,246,.5)" },
  secondaryCTA: { background: "transparent", color: "#e5e7eb", padding: "16px 32px", borderRadius: 12, textDecoration: "none", fontWeight: 600, fontSize: 16, border: "1px solid rgba(255,255,255,.15)" },
  trust: { marginTop: 24, color: "#64748b", fontSize: 13 },
  section: { maxWidth: 1080, margin: "0 auto", padding: "60px 24px" },
  h2: { fontSize: 40, fontWeight: 800, textAlign: "center" as const, margin: "0 0 8px", letterSpacing: -0.5 },
  sectionSub: { textAlign: "center" as const, color: "#94a3b8", margin: "0 0 40px", fontSize: 16 },
  steps: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20, marginTop: 40 },
  step: { background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, padding: 28 },
  stepN: { width: 36, height: 36, borderRadius: "50%", background: "linear-gradient(135deg,#3b82f6,#a855f7)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, marginBottom: 16 },
  stepT: { fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 6 },
  stepD: { color: "#94a3b8", fontSize: 14, lineHeight: 1.5 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 },
  card: { background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, padding: 24, position: "relative" as const, display: "flex", flexDirection: "column" as const },
  cardPop: { border: "1px solid #3b82f6", background: "rgba(59,130,246,.08)" },
  popBadge: { position: "absolute" as const, top: -10, left: "50%", transform: "translateX(-50%)", background: "#3b82f6", color: "#fff", padding: "3px 12px", borderRadius: 999, fontSize: 11, fontWeight: 700 },
  cardName: { fontSize: 13, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: 0.5 },
  cardPrice: { fontSize: 36, fontWeight: 800, color: "#fff", margin: "12px 0 4px" },
  cardDur: { color: "#94a3b8", fontSize: 14, marginBottom: 20 },
  cardBtn: { marginTop: "auto", background: "#fff", color: "#0a0a0f", padding: "10px", borderRadius: 8, fontWeight: 600, textDecoration: "none", textAlign: "center" as const, fontSize: 14 },
  feats: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, marginTop: 40 },
  feat: { background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 12, padding: 24 },
  featT: { fontSize: 16, fontWeight: 700, color: "#fff", marginBottom: 8 },
  featD: { color: "#94a3b8", fontSize: 14, lineHeight: 1.5 },
  footer: { borderTop: "1px solid rgba(255,255,255,.06)", padding: "24px 40px", display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: 13, marginTop: 40 },
  footerLink: { color: "#64748b", textDecoration: "none" },
};
