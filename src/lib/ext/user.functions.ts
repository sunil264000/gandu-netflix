// User-facing license flow: trial claim, list licenses, pricing, order + stub checkout.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { randomLicenseKey, deriveLicenseSecret, sha256Hex } from "@/lib/ext/crypto.server";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";

function callerIp(): string {
  const xff = getRequestHeader("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return getRequestHeader("x-real-ip") ?? "0.0.0.0";
}

export const listPublicPlans = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("plans")
    .select("code,name,price_inr,duration_seconds,max_devices,monthly_credits,is_trial,sort_order,features")
    .eq("is_public", true)
    .order("sort_order");
  return { plans: data ?? [] };
});

export const claimTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { fingerprint: string }) =>
    z.object({ fingerprint: z.string().min(32).max(256) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const ip = callerIp();
    const fpHash = await sha256Hex(data.fingerprint);

    // Existing trial for this user?
    const { data: existing } = await supabaseAdmin
      .from("licenses")
      .select("id,key,activated_at,expires_at,duration_seconds")
      .eq("user_id", context.userId)
      .eq("is_trial", true)
      .maybeSingle();
    if (existing) return { ok: true, license: existing, reused: true };

    // Fingerprint or IP already used another account for a trial?
    const { data: dupFp } = await supabaseAdmin
      .from("licenses").select("id").eq("is_trial", true).eq("trial_fp_hash", fpHash).limit(1).maybeSingle();
    if (dupFp) return { ok: false, error: "trial_device_used" };

    const { data: dupIp } = await supabaseAdmin
      .from("licenses").select("id").eq("is_trial", true).eq("trial_ip", ip).limit(1).maybeSingle();
    if (dupIp) return { ok: false, error: "trial_ip_used" };

    const { data: plan } = await supabaseAdmin.from("plans").select("*").eq("code", "trial").maybeSingle();
    if (!plan) return { ok: false, error: "trial_plan_missing" };

    const key = randomLicenseKey();
    const secret = await deriveLicenseSecret(key);
    const { data: lic, error } = await supabaseAdmin.from("licenses").insert({
      key, user_id: context.userId, plan_code: "trial", status: "active",
      credits_remaining: plan.monthly_credits, hmac_secret: secret,
      duration_seconds: plan.duration_seconds, is_trial: true,
      trial_fp_hash: fpHash, trial_ip: ip, notes: `Trial for ${context.claims?.email ?? context.userId}`,
    }).select("id,key,activated_at,expires_at,duration_seconds").single();
    if (error || !lic) return { ok: false, error: error?.message ?? "create_failed" };
    return { ok: true, license: lic, reused: false };
  });

export const listMyLicenses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("licenses")
      .select("id,key,plan_code,status,is_trial,duration_seconds,activated_at,expires_at,credits_remaining,created_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    return { licenses: data ?? [] };
  });

export const createOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { plan_code: string }) =>
    z.object({ plan_code: z.string().min(1) }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: plan } = await supabaseAdmin.from("plans").select("*").eq("code", data.plan_code).maybeSingle();
    if (!plan || plan.is_trial) throw new Error("invalid_plan");
    const { data: order, error } = await supabaseAdmin.from("orders").insert({
      user_id: context.userId, plan_code: plan.code, amount_inr: plan.price_inr, status: "pending", gateway: "stub",
    }).select("id").single();
    if (error || !order) throw new Error(error?.message ?? "order_failed");
    return { order_id: order.id };
  });

export const getOrder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { order_id: string }) =>
    z.object({ order_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: o } = await supabaseAdmin.from("orders")
      .select("id,plan_code,amount_inr,status,license_id,gateway,created_at,paid_at")
      .eq("id", data.order_id).eq("user_id", context.userId).maybeSingle();
    if (!o) throw new Error("not_found");
    let license: { key: string; duration_seconds: number; expires_at: string | null; activated_at: string | null } | null = null;
    if (o.license_id) {
      const { data: l } = await supabaseAdmin.from("licenses")
        .select("key,duration_seconds,expires_at,activated_at").eq("id", o.license_id).maybeSingle();
      license = l ?? null;
    }
    const { data: plan } = await supabaseAdmin.from("plans").select("name,duration_seconds").eq("code", o.plan_code).maybeSingle();
    return { order: o, license, plan };
  });

// Stub gateway: called from /checkout to mark order paid + mint license.
// Replace with real webhook when gateway is chosen. Never trust client here for real payments.
export const confirmStubPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { order_id: string }) =>
    z.object({ order_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order } = await supabaseAdmin.from("orders")
      .select("*").eq("id", data.order_id).eq("user_id", context.userId).maybeSingle();
    if (!order) throw new Error("not_found");
    if (order.status === "paid" && order.license_id) return { ok: true, license_id: order.license_id };
    if (order.status !== "pending") throw new Error("bad_status:" + order.status);
    if (order.gateway !== "stub") throw new Error("real_gateway_pending");

    const { data: plan } = await supabaseAdmin.from("plans").select("*").eq("code", order.plan_code).maybeSingle();
    if (!plan) throw new Error("plan_missing");

    const key = randomLicenseKey();
    const secret = await deriveLicenseSecret(key);
    const { data: lic, error } = await supabaseAdmin.from("licenses").insert({
      key, user_id: context.userId, plan_code: plan.code, status: "active",
      credits_remaining: plan.monthly_credits, hmac_secret: secret,
      duration_seconds: plan.duration_seconds, is_trial: false, order_id: order.id,
      notes: `Order ${order.id.slice(0, 8)}`,
    }).select("id").single();
    if (error || !lic) throw new Error(error?.message ?? "license_create_failed");

    await supabaseAdmin.from("orders").update({
      status: "paid", license_id: lic.id, paid_at: new Date().toISOString(),
    }).eq("id", order.id);
    return { ok: true, license_id: lic.id };
  });
