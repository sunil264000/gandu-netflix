// Owner-only admin server functions.
// - claim_owner: grants admin role to the caller if NO admins exist yet.
//   After the first claim, this endpoint refuses everyone (permanent lock).
// - All other actions require the caller to already have the admin role.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { randomLicenseKey, deriveLicenseSecret } from "@/lib/ext/crypto.server";
import { z } from "zod";

async function assertAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("forbidden");
}

export const claimOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin
      .from("user_roles").select("*", { count: "exact", head: true }).eq("role", "admin");
    if ((count ?? 0) > 0) {
      // Already claimed — is the caller that admin?
      const { data } = await supabaseAdmin
        .from("user_roles").select("role").eq("user_id", context.userId).eq("role", "admin").maybeSingle();
      if (data) return { ok: true, already: true };
      throw new Error("owner_already_claimed");
    }
    const { error } = await supabaseAdmin
      .from("user_roles").insert({ user_id: context.userId, role: "admin" });
    if (error) throw new Error(error.message);
    return { ok: true, claimed: true };
  });

export const isOwner = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", context.userId).eq("role", "admin").maybeSingle();
    const { count } = await supabaseAdmin
      .from("user_roles").select("*", { count: "exact", head: true }).eq("role", "admin");
    return { isAdmin: !!data, anyAdminExists: (count ?? 0) > 0 };
  });

export const listPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("plans").select("*").order("price_inr");
    return { plans: data ?? [] };
  });

export const listLicenses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("licenses")
      .select("id,key,plan_code,status,credits_remaining,credits_reset_at,notes,created_at")
      .order("created_at", { ascending: false }).limit(500);
    return { licenses: data ?? [] };
  });

export const createLicense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { plan_code: string; notes?: string }) =>
    z.object({ plan_code: z.string().min(1), notes: z.string().optional() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: p } = await supabaseAdmin.from("plans").select("*").eq("code", data.plan_code).maybeSingle();
    if (!p) throw new Error("plan_missing");
    const key = randomLicenseKey();
    const hmac = await deriveLicenseSecret(key);
    const { data: lic, error } = await supabaseAdmin.from("licenses").insert({
      key, plan_code: data.plan_code, credits_remaining: p.monthly_credits,
      hmac_secret: hmac, notes: data.notes ?? null,
    }).select().single();
    if (error) throw new Error(error.message);
    return { license: lic };
  });

export const setLicenseStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { license_id: string; status: "active" | "paused" | "revoked" }) =>
    z.object({ license_id: z.string().uuid(), status: z.enum(["active", "paused", "revoked"]) }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("licenses").update({ status: data.status }).eq("id", data.license_id);
    return { ok: true };
  });

export const killLicense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { license_id: string; reason?: string }) =>
    z.object({ license_id: z.string().uuid(), reason: z.string().optional() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("kill_switch").upsert({
      license_id: data.license_id, reason: data.reason ?? "admin",
    });
    await supabaseAdmin.from("sessions").update({ revoked: true }).eq("license_id", data.license_id);
    return { ok: true };
  });

export const unkillLicense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { license_id: string }) =>
    z.object({ license_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("kill_switch").delete().eq("license_id", data.license_id);
    return { ok: true };
  });

export const adjustCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { license_id: string; credits: number }) =>
    z.object({ license_id: z.string().uuid(), credits: z.number().int().min(0) }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("licenses").update({ credits_remaining: data.credits }).eq("id", data.license_id);
    return { ok: true };
  });

export const listDevices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { license_id: string }) =>
    z.object({ license_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin.from("devices").select("*")
      .eq("license_id", data.license_id).order("created_at", { ascending: false });
    return { devices: rows ?? [] };
  });

export const revokeDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { device_id: string }) =>
    z.object({ device_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("devices").update({ revoked: true }).eq("id", data.device_id);
    return { ok: true };
  });

export const listUsage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { license_id: string }) =>
    z.object({ license_id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin.from("usage_events").select("*")
      .eq("license_id", data.license_id).order("created_at", { ascending: false }).limit(200);
    return { usage: rows ?? [] };
  });
