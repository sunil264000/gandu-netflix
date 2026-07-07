// Landing page — AI Infinity marketing site.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "AI Infinity — Unlimited AI credits, on any project" },
      { name: "description", content: "Extension that gives you unlimited Lovable AI credits. Start with a 15-minute free trial, upgrade to daily / weekly / monthly plans. Countdown starts on first activation." },
      { property: "og:title", content: "AI Infinity — Unlimited AI, unlimited creativity" },
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

function useReveal() {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setShown(true)),
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, shown };
}

function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const { ref, shown } = useReveal();
  return (
    <div
      ref={ref}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "translateY(0)" : "translateY(24px)",
        transition: `opacity .8s ease ${delay}ms, transform .8s cubic-bezier(.2,.7,.2,1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

function Landing() {
  const [signedIn, setSignedIn] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [mouse, setMouse] = useState({ x: 0.5, y: 0.5 });

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
    const onScroll = () => setScrolled(window.scrollY > 20);
    const onMove = (e: MouseEvent) => setMouse({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    window.addEventListener("scroll", onScroll);
    window.addEventListener("mousemove", onMove);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("mousemove", onMove); };
  }, []);

  return (
    <div style={s.page}>
      <style>{keyframes}</style>

      {/* Animated background */}
      <div style={s.bgWrap} aria-hidden>
        <div style={{ ...s.blob, ...s.blob1, transform: `translate(${mouse.x * 40 - 20}px, ${mouse.y * 40 - 20}px)` }} />
        <div style={{ ...s.blob, ...s.blob2, transform: `translate(${mouse.x * -30 + 15}px, ${mouse.y * -30 + 15}px)` }} />
        <div style={{ ...s.blob, ...s.blob3 }} />
        <div style={s.grid} />
      </div>

      <header style={{ ...s.nav, ...(scrolled ? s.navScrolled : {}) }}>
        <Link to="/" style={s.logo}>
          <span style={s.logoMark}/>
          <span>AI Infinity</span>
        </Link>
        <nav style={s.navRight}>
          <a href="#how" style={s.navLink} className="nav-link">How it works</a>
          <a href="#pricing" style={s.navLink} className="nav-link">Pricing</a>
          <a href="#why" style={s.navLink} className="nav-link">Why us</a>
          {signedIn
            ? <Link to="/dashboard" style={s.navCTA} className="cta">Dashboard →</Link>
            : <Link to="/auth" style={s.navCTA} className="cta">Sign in →</Link>}
        </nav>
      </header>

      <section style={s.hero}>
        <div style={s.badge} className="float">
          <span style={s.badgeDot} />
          Now with 15-minute instant free trial
        </div>
        <h1 style={s.h1}>
          Unlimited Lovable AI.<br/>
          <span style={s.gradient} className="shimmer">Zero limits.</span>
        </h1>
        <p style={s.heroSub}>
          A hardened Chrome extension that unlocks unlimited Lovable AI credits on any project.
          Instant activation. Real device-locked keys. Kill-switch protected.
        </p>
        <div style={s.heroCTAs}>
          <Link to={signedIn ? "/dashboard" : "/auth"} style={s.primaryCTA} className="cta-primary">
            Start free — 15 minutes
            <span style={s.arrow}>→</span>
          </Link>
          <a href="#pricing" style={s.secondaryCTA} className="cta-secondary">See plans</a>
        </div>
        <div style={s.trust}>
          <span style={s.trustDot}>●</span> No card required
          <span style={s.trustSep}>·</span>
          Trial starts on activation
          <span style={s.trustSep}>·</span>
          Cancel anytime
        </div>
      </section>

      <section id="how" style={s.section}>
        <Reveal>
          <h2 style={s.h2}>How it works</h2>
          <p style={s.sectionSub}>Three steps. Sixty seconds.</p>
        </Reveal>
        <div style={s.steps}>
          {[
            { n: "1", t: "Sign in", d: "Google or email. One click.", icon: "◉" },
            { n: "2", t: "Get your key", d: "Free 15-min trial issued instantly. Or buy a plan.", icon: "◈" },
            { n: "3", t: "Paste & go", d: "Countdown starts the moment you activate — never a second before.", icon: "◆" },
          ].map((x, i) => (
            <Reveal key={x.n} delay={i * 120}>
              <div style={s.step} className="tilt-card">
                <div style={s.stepIcon}>{x.icon}</div>
                <div style={s.stepN}>Step {x.n}</div>
                <div style={s.stepT}>{x.t}</div>
                <div style={s.stepD}>{x.d}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="pricing" style={s.section}>
        <Reveal>
          <h2 style={s.h2}>Simple pricing</h2>
          <p style={s.sectionSub}>Pay for time, not usage. All plans deliver instantly.</p>
        </Reveal>
        <div style={s.grid2}>
          {plans.map((p, i) => (
            <Reveal key={p.code} delay={i * 70}>
              <div style={{ ...s.card, ...(p.pop ? s.cardPop : {}) }} className="tilt-card">
                {p.pop && <div style={s.popBadge}>★ Most popular</div>}
                <div style={s.cardName}>{p.name}</div>
                <div style={s.cardPrice}>
                  <span style={s.cardCurrency}>₹</span>{p.price.toLocaleString("en-IN")}
                </div>
                <div style={s.cardDur}>{p.dur}</div>
                <Link to={signedIn ? "/dashboard" : "/auth"} style={p.pop ? s.cardBtnPop : s.cardBtn} className="cta">
                  Choose {p.name}
                </Link>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section id="why" style={s.section}>
        <Reveal>
          <h2 style={s.h2}>Why AI Infinity</h2>
          <p style={s.sectionSub}>Built for people who ship.</p>
        </Reveal>
        <div style={s.feats}>
          {[
            { t: "Hardware-locked", d: "Every key binds to your device fingerprint. Nobody else can use it — even if leaked.", i: "🔒" },
            { t: "Countdown on activation", d: "Buy today, activate next week. Timer only starts on first activation.", i: "⏱" },
            { t: "Server-authoritative", d: "5-minute JWT sessions, 60s replay protection, HMAC-signed on every request.", i: "🛡" },
            { t: "Kill-switch protected", d: "Instant revocation across all devices in <60 seconds if a key is misused.", i: "⚡" },
          ].map((f, i) => (
            <Reveal key={f.t} delay={i * 80}>
              <div style={s.feat} className="tilt-card">
                <div style={s.featIcon}>{f.i}</div>
                <div style={s.featT}>{f.t}</div>
                <div style={s.featD}>{f.d}</div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section style={{ ...s.section, textAlign: "center" }}>
        <Reveal>
          <div style={s.ctaCard} className="glow-border">
            <h2 style={{ ...s.h2, margin: 0 }}>Ready to go infinite?</h2>
            <p style={{ ...s.sectionSub, marginTop: 12 }}>Claim your free 15-minute key in one click.</p>
            <Link to={signedIn ? "/dashboard" : "/auth"} style={s.primaryCTA} className="cta-primary">
              Start free now <span style={s.arrow}>→</span>
            </Link>
          </div>
        </Reveal>
      </section>

      <footer style={s.footer}>
        <div>© {new Date().getFullYear()} AI Infinity</div>
        <div><Link to="/admin" style={s.footerLink}>Admin</Link></div>
      </footer>
    </div>
  );
}

const keyframes = `
  @keyframes float { 0%,100% { transform: translateY(0);} 50% { transform: translateY(-6px);} }
  @keyframes shimmer { 0% { background-position: 0% 50%;} 100% { background-position: 200% 50%;} }
  @keyframes blob { 0%,100% { border-radius: 42% 58% 60% 40% / 45% 45% 55% 55%;} 50% { border-radius: 60% 40% 42% 58% / 55% 60% 40% 45%;} }
  @keyframes pulse { 0%,100% { opacity: .7; transform: scale(1);} 50% { opacity: 1; transform: scale(1.2);} }
  @keyframes glow { 0%,100% { box-shadow: 0 0 30px rgba(99,102,241,.3), 0 0 60px rgba(168,85,247,.15);} 50% { box-shadow: 0 0 45px rgba(99,102,241,.5), 0 0 100px rgba(168,85,247,.3);} }
  .float { animation: float 3.5s ease-in-out infinite; }
  .shimmer { background-size: 200% auto; animation: shimmer 4s linear infinite; }
  .nav-link { position: relative; transition: color .25s ease; }
  .nav-link:hover { color: #fff !important; }
  .nav-link::after { content: ""; position: absolute; left: 0; bottom: -4px; width: 100%; height: 1px; background: linear-gradient(90deg,#3b82f6,#a855f7); transform: scaleX(0); transform-origin: right; transition: transform .35s ease; }
  .nav-link:hover::after { transform: scaleX(1); transform-origin: left; }
  .cta { transition: transform .2s ease, box-shadow .25s ease, background .25s ease; }
  .cta:hover { transform: translateY(-2px); }
  .cta-primary { transition: transform .25s ease, box-shadow .3s ease; position: relative; overflow: hidden; }
  .cta-primary::before { content: ""; position: absolute; inset: 0; background: linear-gradient(120deg, transparent 30%, rgba(255,255,255,.35) 50%, transparent 70%); transform: translateX(-100%); transition: transform .8s ease; }
  .cta-primary:hover { transform: translateY(-3px) scale(1.02); box-shadow: 0 25px 55px -12px rgba(99,102,241,.7); }
  .cta-primary:hover::before { transform: translateX(100%); }
  .cta-secondary { transition: all .25s ease; }
  .cta-secondary:hover { border-color: rgba(255,255,255,.4) !important; background: rgba(255,255,255,.05) !important; transform: translateY(-2px); }
  .tilt-card { transition: transform .35s cubic-bezier(.2,.7,.2,1), border-color .3s ease, background .3s ease, box-shadow .35s ease; }
  .tilt-card:hover { transform: translateY(-6px); border-color: rgba(99,102,241,.5) !important; background: rgba(255,255,255,.055) !important; box-shadow: 0 25px 50px -20px rgba(99,102,241,.4); }
  .glow-border { animation: glow 3s ease-in-out infinite; }
  html { scroll-behavior: smooth; }
`;

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#07070c", color: "#e5e7eb", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", position: "relative", overflow: "hidden" },
  bgWrap: { position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" },
  blob: { position: "absolute", filter: "blur(80px)", opacity: 0.55, animation: "blob 14s ease-in-out infinite", transition: "transform .8s ease-out" },
  blob1: { width: 520, height: 520, background: "radial-gradient(circle, #3b82f6, transparent 70%)", top: -120, left: -80 },
  blob2: { width: 480, height: 480, background: "radial-gradient(circle, #a855f7, transparent 70%)", top: 200, right: -100 },
  blob3: { width: 420, height: 420, background: "radial-gradient(circle, #ec4899, transparent 70%)", bottom: -120, left: "40%", opacity: 0.35 },
  grid: { position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)", backgroundSize: "48px 48px", maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)" },

  nav: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 40px", position: "sticky", top: 0, zIndex: 20, transition: "all .3s ease", background: "rgba(7,7,12,.4)", backdropFilter: "blur(6px)", borderBottom: "1px solid transparent" },
  navScrolled: { background: "rgba(7,7,12,.8)", backdropFilter: "blur(14px)", borderBottom: "1px solid rgba(255,255,255,.06)", padding: "14px 40px" },
  logo: { display: "flex", alignItems: "center", gap: 10, fontWeight: 700, fontSize: 16, color: "#fff", textDecoration: "none" },
  logoMark: { width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#3b82f6,#a855f7,#ec4899)", boxShadow: "0 0 20px rgba(168,85,247,.5)" },
  navRight: { display: "flex", gap: 28, alignItems: "center" },
  navLink: { color: "#94a3b8", textDecoration: "none", fontSize: 14, fontWeight: 500 },
  navCTA: { background: "linear-gradient(135deg,#fff,#e2e8f0)", color: "#0a0a0f", padding: "9px 18px", borderRadius: 10, textDecoration: "none", fontSize: 14, fontWeight: 600 },

  hero: { position: "relative", zIndex: 1, maxWidth: 960, margin: "0 auto", padding: "120px 24px 100px", textAlign: "center" as const },
  badge: { display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(59,130,246,.12)", border: "1px solid rgba(59,130,246,.3)", color: "#93c5fd", padding: "7px 16px", borderRadius: 999, fontSize: 12, fontWeight: 600, marginBottom: 28, backdropFilter: "blur(10px)" },
  badgeDot: { width: 6, height: 6, borderRadius: "50%", background: "#3b82f6", animation: "pulse 1.8s ease-in-out infinite", display: "inline-block" },
  h1: { fontSize: "clamp(44px, 8vw, 82px)", fontWeight: 800, lineHeight: 1.02, margin: "0 0 24px", letterSpacing: -2 },
  gradient: { background: "linear-gradient(90deg,#3b82f6,#a855f7,#ec4899,#a855f7,#3b82f6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" },
  heroSub: { fontSize: 19, color: "#94a3b8", maxWidth: 640, margin: "0 auto 40px", lineHeight: 1.55 },
  heroCTAs: { display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap" as const },
  primaryCTA: { display: "inline-flex", alignItems: "center", gap: 10, background: "linear-gradient(135deg,#3b82f6,#6366f1,#a855f7)", color: "#fff", padding: "16px 32px", borderRadius: 12, textDecoration: "none", fontWeight: 700, fontSize: 16, boxShadow: "0 20px 40px -12px rgba(99,102,241,.5)", marginTop: 20 },
  arrow: { display: "inline-block", transition: "transform .25s ease" },
  secondaryCTA: { display: "inline-flex", alignItems: "center", background: "rgba(255,255,255,.02)", color: "#e5e7eb", padding: "16px 32px", borderRadius: 12, textDecoration: "none", fontWeight: 600, fontSize: 16, border: "1px solid rgba(255,255,255,.15)", backdropFilter: "blur(10px)", marginTop: 20 },
  trust: { marginTop: 28, color: "#64748b", fontSize: 13, display: "flex", justifyContent: "center", alignItems: "center", gap: 8, flexWrap: "wrap" as const },
  trustDot: { color: "#10b981", fontSize: 10 },
  trustSep: { opacity: .5 },

  section: { position: "relative", zIndex: 1, maxWidth: 1120, margin: "0 auto", padding: "80px 24px" },
  h2: { fontSize: "clamp(32px, 5vw, 44px)", fontWeight: 800, textAlign: "center" as const, margin: "0 0 10px", letterSpacing: -1, color: "#fff" },
  sectionSub: { textAlign: "center" as const, color: "#94a3b8", margin: "0 0 48px", fontSize: 16 },

  steps: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 },
  step: { background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 20, padding: 32, backdropFilter: "blur(10px)", height: "100%" },
  stepIcon: { fontSize: 28, background: "linear-gradient(135deg,#3b82f6,#a855f7)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", marginBottom: 16 },
  stepN: { fontSize: 11, fontWeight: 700, color: "#93c5fd", textTransform: "uppercase" as const, letterSpacing: 1.5, marginBottom: 8 },
  stepT: { fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 8 },
  stepD: { color: "#94a3b8", fontSize: 14, lineHeight: 1.6 },

  grid2: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 18 },
  card: { background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 20, padding: 28, position: "relative" as const, display: "flex", flexDirection: "column" as const, backdropFilter: "blur(10px)", height: "100%" },
  cardPop: { border: "1px solid rgba(99,102,241,.6)", background: "linear-gradient(180deg, rgba(99,102,241,.12), rgba(168,85,247,.05))", boxShadow: "0 20px 50px -20px rgba(99,102,241,.5)" },
  popBadge: { position: "absolute" as const, top: -12, left: "50%", transform: "translateX(-50%)", background: "linear-gradient(135deg,#3b82f6,#a855f7)", color: "#fff", padding: "4px 14px", borderRadius: 999, fontSize: 11, fontWeight: 700, boxShadow: "0 8px 20px -6px rgba(168,85,247,.6)" },
  cardName: { fontSize: 12, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" as const, letterSpacing: 1 },
  cardPrice: { fontSize: 40, fontWeight: 800, color: "#fff", margin: "14px 0 4px", display: "flex", alignItems: "baseline", gap: 4 },
  cardCurrency: { fontSize: 22, color: "#94a3b8", fontWeight: 600 },
  cardDur: { color: "#94a3b8", fontSize: 14, marginBottom: 22 },
  cardBtn: { marginTop: "auto", background: "rgba(255,255,255,.06)", color: "#fff", padding: "11px", borderRadius: 10, fontWeight: 600, textDecoration: "none", textAlign: "center" as const, fontSize: 14, border: "1px solid rgba(255,255,255,.1)" },
  cardBtnPop: { marginTop: "auto", background: "linear-gradient(135deg,#3b82f6,#a855f7)", color: "#fff", padding: "11px", borderRadius: 10, fontWeight: 700, textDecoration: "none", textAlign: "center" as const, fontSize: 14 },

  feats: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18 },
  feat: { background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 16, padding: 26, backdropFilter: "blur(10px)", height: "100%" },
  featIcon: { fontSize: 26, marginBottom: 14 },
  featT: { fontSize: 17, fontWeight: 700, color: "#fff", marginBottom: 8 },
  featD: { color: "#94a3b8", fontSize: 14, lineHeight: 1.6 },

  ctaCard: { background: "linear-gradient(135deg, rgba(59,130,246,.08), rgba(168,85,247,.08))", border: "1px solid rgba(99,102,241,.25)", borderRadius: 24, padding: "56px 32px", backdropFilter: "blur(14px)" },

  footer: { position: "relative", zIndex: 1, borderTop: "1px solid rgba(255,255,255,.06)", padding: "28px 40px", display: "flex", justifyContent: "space-between", color: "#64748b", fontSize: 13, marginTop: 40 },
  footerLink: { color: "#64748b", textDecoration: "none" },
};
