-- Run this in your Supabase SQL editor to set up the required tables

-- Client configs (managed via admin dashboard)
CREATE TABLE IF NOT EXISTS clients (
  slug TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on clients" ON clients
  FOR ALL USING (true) WITH CHECK (true);

-- Client passwords (managed via admin dashboard)
CREATE TABLE IF NOT EXISTS client_passwords (
  slug TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Analytics events (login, app usage, feature tracking)
CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_slug TEXT NOT NULL,
  user_identifier TEXT,
  app_name TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_data JSONB DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_client ON analytics_events(client_slug);
CREATE INDEX IF NOT EXISTS idx_analytics_app ON analytics_events(app_name);
CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at DESC);

-- Enable Row Level Security
ALTER TABLE client_passwords ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Service role policies (server-side only)
CREATE POLICY "Service role full access on passwords" ON client_passwords
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access on analytics" ON analytics_events
  FOR ALL USING (true) WITH CHECK (true);

-- Client work history (saved outputs from all apps)
CREATE TABLE IF NOT EXISTS client_work (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug TEXT NOT NULL,
  app_type TEXT NOT NULL,
  title TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_slug ON client_work(slug);
CREATE INDEX IF NOT EXISTS idx_work_app ON client_work(slug, app_type);
CREATE INDEX IF NOT EXISTS idx_work_created ON client_work(created_at DESC);

ALTER TABLE client_work ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access on client_work" ON client_work
  FOR ALL USING (true) WITH CHECK (true);
