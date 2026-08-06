REVOKE SELECT ON public.licenses FROM authenticated;
REVOKE SELECT ON public.licenses FROM anon;
GRANT SELECT (id, key, user_id, plan_code, status, credits_remaining, credits_reset_at, notes, created_at, updated_at, duration_seconds, activated_at, expires_at, is_trial, order_id) ON public.licenses TO authenticated;
GRANT ALL ON public.licenses TO service_role;