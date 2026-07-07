
-- ============ ROLES ============
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "users read own role" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "admins read all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ PLANS ============
CREATE TABLE public.plans (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  max_devices INT NOT NULL DEFAULT 1,
  monthly_credits INT NOT NULL DEFAULT 0,
  price_inr INT NOT NULL DEFAULT 0,
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.plans TO anon, authenticated;
GRANT ALL ON public.plans TO service_role;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone reads public plans" ON public.plans
  FOR SELECT TO anon, authenticated USING (is_public = true);
CREATE POLICY "admins manage plans" ON public.plans
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ LICENSES ============
CREATE TABLE public.licenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  plan_code TEXT NOT NULL REFERENCES public.plans(code),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','revoked')),
  credits_remaining INT NOT NULL DEFAULT 0,
  credits_reset_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 days'),
  hmac_secret TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_licenses_user ON public.licenses(user_id);
CREATE INDEX idx_licenses_status ON public.licenses(status);

GRANT SELECT ON public.licenses TO authenticated;
GRANT ALL ON public.licenses TO service_role;
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own licenses" ON public.licenses
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "admins manage licenses" ON public.licenses
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ DEVICES ============
CREATE TABLE public.devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id UUID NOT NULL REFERENCES public.licenses(id) ON DELETE CASCADE,
  fingerprint_hash TEXT NOT NULL,
  first_seen_ip TEXT,
  last_seen_ip TEXT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent TEXT,
  ext_version TEXT,
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (license_id, fingerprint_hash)
);

CREATE INDEX idx_devices_license ON public.devices(license_id);

GRANT SELECT ON public.devices TO authenticated;
GRANT ALL ON public.devices TO service_role;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own devices" ON public.devices
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.licenses l WHERE l.id = license_id AND l.user_id = auth.uid())
  );
CREATE POLICY "admins manage devices" ON public.devices
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ SESSIONS ============
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  license_id UUID NOT NULL REFERENCES public.licenses(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES public.devices(id) ON DELETE CASCADE,
  jti TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_device ON public.sessions(device_id);
CREATE INDEX idx_sessions_jti ON public.sessions(jti);

GRANT ALL ON public.sessions TO service_role;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read sessions" ON public.sessions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ USAGE EVENTS ============
CREATE TABLE public.usage_events (
  id BIGSERIAL PRIMARY KEY,
  license_id UUID NOT NULL REFERENCES public.licenses(id) ON DELETE CASCADE,
  device_id UUID REFERENCES public.devices(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  credits_spent INT NOT NULL DEFAULT 0,
  ip TEXT,
  ua TEXT,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_usage_license_time ON public.usage_events(license_id, created_at DESC);

GRANT ALL ON public.usage_events TO service_role;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own usage" ON public.usage_events
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.licenses l WHERE l.id = license_id AND l.user_id = auth.uid())
  );
CREATE POLICY "admins read all usage" ON public.usage_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- ============ KILL SWITCH ============
CREATE TABLE public.kill_switch (
  license_id UUID PRIMARY KEY REFERENCES public.licenses(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT ALL ON public.kill_switch TO service_role;
ALTER TABLE public.kill_switch ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage kill switch" ON public.kill_switch
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ ANOMALY FLAGS ============
CREATE TABLE public.anomaly_flags (
  id BIGSERIAL PRIMARY KEY,
  license_id UUID NOT NULL REFERENCES public.licenses(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_anomaly_license ON public.anomaly_flags(license_id, created_at DESC);

GRANT ALL ON public.anomaly_flags TO service_role;
ALTER TABLE public.anomaly_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read anomalies" ON public.anomaly_flags
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "admins manage anomalies" ON public.anomaly_flags
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ============ TIMESTAMP TRIGGER ============
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_plans_updated BEFORE UPDATE ON public.plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_licenses_updated BEFORE UPDATE ON public.licenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ SEED PLANS ============
INSERT INTO public.plans (code, name, max_devices, monthly_credits, price_inr, features) VALUES
  ('free',  'Free',  1, 100,   0, '{"pro_features": false}'::jsonb),
  ('pro',   'Pro',   2, 5000,  499, '{"pro_features": true}'::jsonb),
  ('team',  'Team',  5, 25000, 1999, '{"pro_features": true, "team_dashboard": true}'::jsonb);
