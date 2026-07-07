
-- ============ EXTEND PLANS ============
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS duration_seconds INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 100;

-- Seed / upsert real plans
INSERT INTO public.plans (code, name, max_devices, monthly_credits, price_inr, duration_seconds, is_trial, is_public, sort_order, features)
VALUES
  ('trial',    '15-Minute Free Trial', 1, 50,     0,        900,      true,  true, 0, '{"tier":"trial"}'::jsonb),
  ('day',      '1 Day Pass',           1, 1000,   150,      86400,    false, true, 10, '{"tier":"basic"}'::jsonb),
  ('week',     '7 Day Pass',           2, 8000,   899,      604800,   false, true, 20, '{"tier":"basic"}'::jsonb),
  ('month',    '1 Month',              2, 40000,  2999,     2592000,  false, true, 30, '{"tier":"pro"}'::jsonb),
  ('quarter',  '3 Months',             3, 130000, 7499,     7776000,  false, true, 40, '{"tier":"pro"}'::jsonb),
  ('halfyear', '6 Months',             3, 275000, 12999,    15552000, false, true, 50, '{"tier":"pro"}'::jsonb),
  ('year',     '1 Year',               5, 600000, 20000,    31536000, false, true, 60, '{"tier":"elite"}'::jsonb)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    max_devices = EXCLUDED.max_devices,
    monthly_credits = EXCLUDED.monthly_credits,
    price_inr = EXCLUDED.price_inr,
    duration_seconds = EXCLUDED.duration_seconds,
    is_trial = EXCLUDED.is_trial,
    is_public = EXCLUDED.is_public,
    sort_order = EXCLUDED.sort_order,
    features = EXCLUDED.features,
    updated_at = now();

-- Hide old placeholder plans that don't fit the new model
UPDATE public.plans SET is_public = false WHERE code IN ('free','pro','team');

-- ============ EXTEND LICENSES ============
ALTER TABLE public.licenses
  ADD COLUMN IF NOT EXISTS duration_seconds INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_trial BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_fp_hash TEXT,
  ADD COLUMN IF NOT EXISTS trial_ip TEXT,
  ADD COLUMN IF NOT EXISTS order_id UUID;

CREATE INDEX IF NOT EXISTS idx_licenses_expires ON public.licenses(expires_at);
CREATE INDEX IF NOT EXISTS idx_licenses_trial_fp ON public.licenses(trial_fp_hash) WHERE is_trial;
CREATE INDEX IF NOT EXISTS idx_licenses_trial_ip ON public.licenses(trial_ip) WHERE is_trial;

-- ============ ORDERS ============
CREATE TABLE IF NOT EXISTS public.orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL REFERENCES public.plans(code),
  amount_inr INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled')),
  gateway TEXT NOT NULL DEFAULT 'stub',
  gateway_ref TEXT,
  license_id UUID REFERENCES public.licenses(id) ON DELETE SET NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_user ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);

GRANT SELECT ON public.orders TO authenticated;
GRANT ALL ON public.orders TO service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own orders" ON public.orders
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "admins manage orders" ON public.orders
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_orders_updated_at BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
