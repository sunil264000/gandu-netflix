// Shared page effects: animated background + entrance transition + reveal helper.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";

export const fxKeyframes = `
  @keyframes fx-float { 0%,100% { transform: translateY(0);} 50% { transform: translateY(-6px);} }
  @keyframes fx-shimmer { 0% { background-position: 0% 50%;} 100% { background-position: 200% 50%;} }
  @keyframes fx-blob { 0%,100% { border-radius: 42% 58% 60% 40% / 45% 45% 55% 55%;} 50% { border-radius: 60% 40% 42% 58% / 55% 60% 40% 45%;} }
  @keyframes fx-pulse { 0%,100% { opacity: .7; transform: scale(1);} 50% { opacity: 1; transform: scale(1.25);} }
  @keyframes fx-glow { 0%,100% { box-shadow: 0 0 30px rgba(99,102,241,.3), 0 0 60px rgba(168,85,247,.15);} 50% { box-shadow: 0 0 45px rgba(99,102,241,.5), 0 0 100px rgba(168,85,247,.3);} }
  @keyframes fx-in { from { opacity: 0; transform: translateY(14px) scale(.99);} to { opacity: 1; transform: translateY(0) scale(1);} }
  @keyframes fx-spin { to { transform: rotate(360deg);} }
  .fx-shimmer { background-size: 200% auto; animation: fx-shimmer 4s linear infinite; }
  .fx-float { animation: fx-float 3.5s ease-in-out infinite; }
  .fx-glow { animation: fx-glow 3s ease-in-out infinite; }
  .fx-page-enter { animation: fx-in .5s cubic-bezier(.2,.7,.2,1) both; }
  .fx-cta { transition: transform .2s ease, box-shadow .3s ease, background .25s ease, border-color .25s ease; position: relative; overflow: hidden; }
  .fx-cta:hover { transform: translateY(-2px); }
  .fx-cta-primary::before { content:""; position:absolute; inset:0; background: linear-gradient(120deg, transparent 30%, rgba(255,255,255,.35) 50%, transparent 70%); transform: translateX(-100%); transition: transform .8s ease; }
  .fx-cta-primary:hover::before { transform: translateX(100%); }
  .fx-cta-primary:hover { transform: translateY(-3px) scale(1.02); box-shadow: 0 25px 55px -12px rgba(99,102,241,.7); }
  .fx-tilt { transition: transform .35s cubic-bezier(.2,.7,.2,1), border-color .3s ease, background .3s ease, box-shadow .35s ease; }
  .fx-tilt:hover { transform: translateY(-6px); border-color: rgba(99,102,241,.5) !important; box-shadow: 0 25px 50px -20px rgba(99,102,241,.4); }
  .fx-input { transition: border-color .2s ease, box-shadow .2s ease, background .2s ease; }
  .fx-input:focus { border-color: rgba(99,102,241,.6) !important; box-shadow: 0 0 0 4px rgba(99,102,241,.15); outline: none; }
  html { scroll-behavior: smooth; }
`;

export function PageBG() {
  const [mouse, setMouse] = useState({ x: 0.5, y: 0.5 });
  useEffect(() => {
    const onMove = (e: MouseEvent) => setMouse({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight });
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);
  return (
    <div aria-hidden style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
      <div style={{ position: "absolute", width: 520, height: 520, top: -120, left: -80, filter: "blur(80px)", opacity: 0.5, animation: "fx-blob 14s ease-in-out infinite", background: "radial-gradient(circle,#3b82f6,transparent 70%)", transition: "transform .8s ease-out", transform: `translate(${mouse.x * 40 - 20}px, ${mouse.y * 40 - 20}px)` }} />
      <div style={{ position: "absolute", width: 480, height: 480, top: 200, right: -100, filter: "blur(80px)", opacity: 0.5, animation: "fx-blob 16s ease-in-out infinite", background: "radial-gradient(circle,#a855f7,transparent 70%)", transition: "transform .8s ease-out", transform: `translate(${mouse.x * -30 + 15}px, ${mouse.y * -30 + 15}px)` }} />
      <div style={{ position: "absolute", width: 420, height: 420, bottom: -120, left: "40%", filter: "blur(80px)", opacity: 0.3, animation: "fx-blob 18s ease-in-out infinite", background: "radial-gradient(circle,#ec4899,transparent 70%)" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)", backgroundSize: "48px 48px", maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)" }} />
    </div>
  );
}

export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div key={pathname} className="fx-page-enter" style={{ position: "relative", zIndex: 1 }}>
      {children}
    </div>
  );
}

export function Reveal({ children, delay = 0 }: { children: ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setShown(true)), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ opacity: shown ? 1 : 0, transform: shown ? "translateY(0)" : "translateY(24px)", transition: `opacity .8s ease ${delay}ms, transform .8s cubic-bezier(.2,.7,.2,1) ${delay}ms` }}>
      {children}
    </div>
  );
}

export function RouteLoadingBar() {
  const isLoading = useRouterState({ select: (s) => s.isLoading || s.isTransitioning });
  return (
    <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 2, zIndex: 100, pointerEvents: "none", opacity: isLoading ? 1 : 0, transition: "opacity .2s ease" }}>
      <div style={{ height: "100%", width: isLoading ? "80%" : "0%", background: "linear-gradient(90deg,#3b82f6,#a855f7,#ec4899)", transition: "width .8s ease", boxShadow: "0 0 12px rgba(168,85,247,.6)" }} />
    </div>
  );
}
