# GateKit API

Hono worker on Cloudflare Workers + D1. Handles gate CRUD, Stripe checkout, webhooks, magic-link auth, and analytics.

## Stack

- **Runtime** — Cloudflare Workers (zero cold starts, global edge)
- **Framework** — Hono v4
- **Database** — Cloudflare D1 (SQLite at the edge)
- **Payments** — Stripe Checkout + Connect
- **Email** — Resend
- **Auth** — Magic links + HS256 JWT (no session storage)

## Local dev

```bash
npm install
wrangler dev
# → http://localhost:8787
```

## Deploy (first time)

### 1. Create D1 database
```bash
wrangler d1 create gatekit-db
# Copy the database_id into wrangler.toml
```

### 2. Run schema migration
```bash
wrangler d1 execute gatekit-db --file=./src/schema.sql
```

### 3. Set secrets
```bash
wrangler secret put STRIPE_SECRET_KEY        # sk_live_...
wrangler secret put STRIPE_WEBHOOK_SECRET    # whsec_...
wrangler secret put RESEND_API_KEY           # re_...
wrangler secret put JWT_SECRET               # openssl rand -base64 32
```

### 4. Deploy
```bash
wrangler deploy
# → https://gatekit-api.YOUR_SUBDOMAIN.workers.dev
```

### 5. Set up Stripe webhook
In Stripe Dashboard → Developers → Webhooks → Add endpoint:
- URL: `https://api.gatekit.io/checkout/webhook`
- Events: `checkout.session.completed`, `charge.refunded`

### 6. Point custom domain
In Cloudflare Dashboard → Workers → your worker → Custom Domains → `api.gatekit.io`

---

## API Reference

### Public (no auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/gates/:slug` | Fetch gate data for embed — used by gate.js |
| `POST` | `/checkout/session` | Create Stripe Checkout session |
| `GET`  | `/checkout/verify?token=&gate=` | Verify a token (gate.js post-payment) |
| `POST` | `/checkout/webhook` | Stripe webhook receiver |
| `POST` | `/events` | Track analytics events from gate.js |
| `POST` | `/auth/magic` | Request magic login link |
| `GET`  | `/auth/verify?token=` | Exchange magic token for JWT |

### Authenticated (Bearer JWT)

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/creators/me` | Get current creator profile |
| `PATCH` | `/creators/me` | Update name |
| `POST` | `/creators/me/stripe-connect` | Start Stripe Connect OAuth |
| `GET`  | `/gates` | List creator's gates |
| `POST` | `/gates` | Create a new gate |
| `PATCH` | `/gates/:id` | Update gate |
| `DELETE` | `/gates/:id` | Delete gate |
| `GET`  | `/gates/:id/analytics?days=14` | Gate analytics |

---

## Revenue flow

```
Visitor pays $1
  → Stripe Checkout Session (application_fee or transfer_data)
  → checkout.session.completed webhook fires
  → verifications row marked completed
  → token returned to browser via success_url ?gk_token=
  → gate.js stores token in localStorage (30-day TTL)
  → visitor sees "Support unlocked" state
  → creator gets email notification
  → 85% payout via Stripe Connect transfer
```

## Environment variables

| Variable | Description |
|----------|-------------|
| `STRIPE_SECRET_KEY` | Stripe secret key (`sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`) |
| `RESEND_API_KEY` | Resend API key for transactional email |
| `JWT_SECRET` | 32+ byte random secret for signing creator JWTs |
