// Stub checkout — instantly marks order paid + mints license.
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getOrder, confirmStubPayment } from "@/lib/ext/user.functions";
import { PageBG } from "@/components/PageFX";

export const Route = createFileRoute("/checkout/$orderId")({ component: Checkout, ssr: false });

type OrderInfo = {
  order: { id: string; plan_code: string; amount_inr: number; status: string; license_id: string | null; gateway: string };
  plan: { name: string; duration_seconds: number } | null;
};

function Checkout() {
  const { orderId } = Route.useParams();
  const nav = useNavigate();
  const [info, setInfo] = useState<OrderInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const _get = useServerFn(getOrder);
  const _pay = useServerFn(confirmStubPayment);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) { nav({ to: "/auth" }); return; }
    try {
      const r = await _get({ data: { order_id: orderId } });
      setInfo(r as OrderInfo);
      if (r.order.status === "paid") nav({ to: "/success/$orderId", params: { orderId } });
    } catch (e) { setErr((e as Error).message); }
  }, [_get, orderId, nav]);

  useEffect(() => { load(); }, [load]);

  const pay = async () => {
    setBusy(true); setErr(null);
    try { await _pay({ data: { order_id: orderId } }); nav({ to: "/success/$orderId", params: { orderId } }); }
    catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <div style={s.page}>
      <PageBG />
      <Link to="/dashboard" style={s.back}>← Dashboard</Link>
      <div style={s.card} className="fx-tilt">
        {err ? (
          <>
            <h1 style={s.h1}>Something went wrong</h1>
            <p style={s.errText}>{err}</p>
          </>
        ) : !info ? (
          <div style={s.loading}>
            <div style={s.spinner} />
            <span>Loading order…</span>
          </div>
        ) : (
          <>
            <div style={s.badge}>◉ Test gateway — no real charge</div>
            <h1 style={s.h1}>Confirm your order</h1>
            <p style={s.subtitle}>Your license is minted the moment payment is confirmed.</p>

            <div style={s.rows}>
              <div style={s.row}><span style={s.rowK}>Plan</span><strong style={s.rowV}>{info.plan?.name ?? info.order.plan_code}</strong></div>
              <div style={s.row}><span style={s.rowK}>Amount</span><strong style={s.rowV}>₹{info.order.amount_inr.toLocaleString("en-IN")}</strong></div>
              <div style={s.row}><span style={s.rowK}>Order ID</span><code style={s.mono}>{info.order.id.slice(0, 8)}…</code></div>
            </div>

            <button onClick={pay} disabled={busy} style={s.pay} className="fx-cta fx-cta-primary">
              {busy ? "Processing…" : `Pay ₹${info.order.amount_inr.toLocaleString("en-IN")}`}
            </button>
            <p style={s.note}>A real payment gateway will replace this screen. Your license is delivered instantly.</p>
          </>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#07070c", color: "#e5e7eb", display: "grid", placeItems: "center", padding: 20, fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", position: "relative", overflow: "hidden" },
  back: { position: "absolute", top: 24, left: 24, color: "#94a3b8", textDecoration: "none", fontSize: 14, zIndex: 2 },
  card: { position: "relative", zIndex: 1, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 20, padding: 36, maxWidth: 460, width: "100%", backdropFilter: "blur(14px)", boxShadow: "0 30px 80px -20px rgba(0,0,0,.5)" },
  badge: { display: "inline-block", background: "rgba(245,158,11,.12)", border: "1px solid rgba(245,158,11,.3)", color: "#fbbf24", padding: "5px 12px", borderRadius: 999, fontSize: 11, fontWeight: 600, marginBottom: 18 },
  h1: { fontSize: 26, fontWeight: 800, margin: "0 0 8px", color: "#fff", letterSpacing: -0.5 },
  subtitle: { color: "#94a3b8", fontSize: 14, margin: "0 0 24px" },
  rows: { background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 12, padding: "4px 16px", marginBottom: 20 },
  row: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,.05)", fontSize: 14 },
  rowK: { color: "#94a3b8" },
  rowV: { color: "#fff" },
  mono: { fontFamily: "'SF Mono', Menlo, monospace", fontSize: 13, color: "#fff" },
  pay: { width: "100%", background: "linear-gradient(135deg,#3b82f6,#6366f1,#a855f7)", color: "#fff", border: "none", padding: "14px", borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: "0 15px 35px -10px rgba(99,102,241,.6)" },
  note: { fontSize: 12, color: "#64748b", marginTop: 16, textAlign: "center" },
  errText: { color: "#fca5a5", background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.25)", padding: 12, borderRadius: 8, fontSize: 13 },
  loading: { display: "flex", alignItems: "center", gap: 12, color: "#94a3b8", padding: "20px 0" },
  spinner: { width: 18, height: 18, border: "2px solid rgba(255,255,255,.15)", borderTopColor: "#a855f7", borderRadius: "50%", animation: "fx-spin 0.8s linear infinite" },
};
