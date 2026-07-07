// Stub checkout — instantly marks order paid + mints license. Replace with real gateway later.
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getOrder, confirmStubPayment } from "@/lib/ext/user.functions";

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

  if (err) return <div style={s.page}><div style={s.card}><h1 style={s.h1}>Something went wrong</h1><p style={s.err}>{err}</p></div></div>;
  if (!info) return <div style={s.page}><div style={s.card}>Loading…</div></div>;

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.badge}>Test gateway · no real charge</div>
        <h1 style={s.h1}>Confirm your order</h1>
        <div style={s.row}><span>Plan</span><strong>{info.plan?.name ?? info.order.plan_code}</strong></div>
        <div style={s.row}><span>Amount</span><strong>₹{info.order.amount_inr.toLocaleString("en-IN")}</strong></div>
        <div style={s.row}><span>Order ID</span><code style={s.mono}>{info.order.id.slice(0, 8)}…</code></div>
        <button onClick={pay} disabled={busy} style={s.btn}>{busy ? "Processing…" : `Pay ₹${info.order.amount_inr.toLocaleString("en-IN")}`}</button>
        <p style={s.note}>A real payment gateway will replace this screen. Your license is delivered instantly on payment.</p>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#f8fafc", display: "grid", placeItems: "center", padding: 20, fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif" },
  card: { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 16, padding: 32, maxWidth: 440, width: "100%" },
  badge: { display: "inline-block", background: "#fef3c7", color: "#78350f", padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600, marginBottom: 16 },
  h1: { fontSize: 22, fontWeight: 700, margin: "0 0 20px" },
  row: { display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid #f1f5f9", fontSize: 14 },
  mono: { fontFamily: "'SF Mono', Menlo, monospace", fontSize: 13 },
  btn: { width: "100%", marginTop: 20, background: "#0f172a", color: "#fff", border: "none", padding: "14px", borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: "pointer" },
  note: { fontSize: 12, color: "#64748b", marginTop: 16, textAlign: "center" as const },
  err: { color: "#b91c1c" },
};
