-- GateKit D1 Schema
-- Run: wrangler d1 execute gatekit-db --file=./src/schema.sql

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── Creators (your paying users) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS creators (
  id          TEXT PRIMARY KEY,               -- cuid2
  email       TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL DEFAULT '',
  stripe_account_id  TEXT,                   -- Stripe Connect account
  stripe_customer_id TEXT,                   -- for Pro subscription
  plan        TEXT NOT NULL DEFAULT 'free'   -- 'free' | 'pro'
    CHECK(plan IN ('free','pro')),
  plan_expires_at    INTEGER,                -- unix ms, null = no expiry
  created_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

-- ── Gates ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gates (
  id          TEXT PRIMARY KEY,              -- cuid2
  creator_id  TEXT NOT NULL REFERENCES creators(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL UNIQUE,          -- URL-safe handle, e.g. "marc"
  name        TEXT NOT NULL,                -- display name shown in modal
  tagline     TEXT NOT NULL DEFAULT '',
  unlock_price_cents INTEGER NOT NULL DEFAULT 100  -- $1 = 100
    CHECK(unlock_price_cents >= 100 AND unlock_price_cents <= 10000),
  contact_url TEXT NOT NULL DEFAULT '',     -- where verified users land
  faq_url     TEXT NOT NULL DEFAULT '',     -- "Browse full FAQ" link
  faqs        TEXT NOT NULL DEFAULT '[]',   -- JSON array [{q, a}]
  show_brand  INTEGER NOT NULL DEFAULT 1    -- 1 = show "Powered by GateKit"
    CHECK(show_brand IN (0,1)),
  is_live     INTEGER NOT NULL DEFAULT 0    -- 1 = active
    CHECK(is_live IN (0,1)),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_gates_creator ON gates(creator_id);
CREATE INDEX IF NOT EXISTS idx_gates_slug    ON gates(slug);

-- ── Verifications (who has unlocked a gate) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS verifications (
  id              TEXT PRIMARY KEY,          -- cuid2
  gate_id         TEXT NOT NULL REFERENCES gates(id) ON DELETE CASCADE,
  token           TEXT NOT NULL UNIQUE,      -- JWT or random secret returned to browser
  email           TEXT,                      -- if captured during checkout
  stripe_payment_id TEXT,                    -- pi_xxx
  amount_cents    INTEGER NOT NULL,
  creator_payout_cents INTEGER NOT NULL,     -- 85% of amount
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','completed','refunded')),
  expires_at      INTEGER NOT NULL,          -- unix ms, 30-day TTL
  created_at      INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_verif_gate  ON verifications(gate_id);
CREATE INDEX IF NOT EXISTS idx_verif_token ON verifications(token);

-- ── Gate events (analytics) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gate_events (
  id         TEXT PRIMARY KEY,
  gate_id    TEXT NOT NULL REFERENCES gates(id) ON DELETE CASCADE,
  event      TEXT NOT NULL                   -- 'view' | 'faq_open' | 'unlock_start' | 'unlock_complete' | 'faq_search'
    CHECK(event IN ('view','faq_open','unlock_start','unlock_complete','faq_search')),
  meta       TEXT,                           -- JSON blob, e.g. {"query": "refund"}
  day        TEXT NOT NULL,                  -- 'YYYY-MM-DD' for easy GROUP BY
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_events_gate_day ON gate_events(gate_id, day);

-- ── Magic link tokens (passwordless auth for creators) ───────────────────────
CREATE TABLE IF NOT EXISTS magic_tokens (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  token      TEXT NOT NULL UNIQUE,
  used       INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_magic_token ON magic_tokens(token);
