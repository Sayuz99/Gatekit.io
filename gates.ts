import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Env, Gate, GatePublic } from '../types'
import { cuid, getCreatorFromJWT, isValidSlug, formatPrice, today } from '../utils'

export const gates = new Hono<{ Bindings: Env }>()

// ── Schema ───────────────────────────────────────────────────────────────────
const faqSchema = z.array(z.object({ q: z.string().min(1), a: z.string().min(1) })).max(20)

const gateCreateSchema = z.object({
  slug:                z.string().min(3).max(40).refine(isValidSlug, 'Invalid slug — use lowercase letters, numbers, hyphens only'),
  name:                z.string().min(1).max(80),
  tagline:             z.string().max(160).default(''),
  unlock_price_cents:  z.number().int().min(100).max(10000).default(100),
  contact_url:         z.string().url().or(z.literal('')).default(''),
  faq_url:             z.string().url().or(z.literal('')).default(''),
  faqs:                faqSchema.default([]),
  show_brand:          z.boolean().default(true),
})

const gateUpdateSchema = gateCreateSchema.partial().omit({ slug: true }).extend({
  is_live: z.boolean().optional(),
})

// ── Helper: shape a Gate row for public embed consumption ─────────────────────
function toPublic(g: Gate): GatePublic {
  return {
    id:                   g.id,
    slug:                 g.slug,
    name:                 g.name,
    tagline:              g.tagline,
    unlock_price_cents:   g.unlock_price_cents,
    unlock_price_display: formatPrice(g.unlock_price_cents),
    contact_url:          g.contact_url,
    faq_url:              g.faq_url,
    faqs:                 JSON.parse(g.faqs),
    show_brand:           g.show_brand === 1,
  }
}

// ── Auth guard shared ─────────────────────────────────────────────────────────
async function requireAuth(c: any): Promise<string | Response> {
  const creatorId = await getCreatorFromJWT(c, c.req.header('Authorization') ?? null)
  if (!creatorId) return c.json({ error: 'Unauthorized' }, 401)
  return creatorId
}

// ── PUBLIC: GET /gates/:slug — used by gate.js embed ─────────────────────────
gates.get('/:slug', async (c) => {
  const { slug } = c.req.param()
  const db = c.env.DB

  const gate = await db.prepare(
    'SELECT * FROM gates WHERE slug = ? AND is_live = 1'
  ).bind(slug).first<Gate>()

  if (!gate) return c.json({ error: 'Gate not found' }, 404)

  // Track view event (fire-and-forget, don't await)
  c.executionCtx.waitUntil(
    db.prepare(
      'INSERT INTO gate_events (id, gate_id, event, day) VALUES (?, ?, ?, ?)'
    ).bind(cuid(), gate.id, 'view', today()).run()
  )

  return c.json(toPublic(gate), 200, {
    'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
  })
})

// ── AUTHED: GET /gates — list creator's own gates ────────────────────────────
gates.get('/', async (c) => {
  const creatorId = await requireAuth(c)
  if (typeof creatorId !== 'string') return creatorId

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM gates WHERE creator_id = ? ORDER BY created_at DESC'
  ).bind(creatorId).all<Gate>()

  return c.json(results.map(g => ({ ...g, faqs: JSON.parse(g.faqs) })))
})

// ── AUTHED: POST /gates — create a gate ──────────────────────────────────────
gates.post(
  '/',
  zValidator('json', gateCreateSchema),
  async (c) => {
    const creatorId = await requireAuth(c)
    if (typeof creatorId !== 'string') return creatorId

    const data = c.req.valid('json')
    const db = c.env.DB

    // Free plan: max 1 gate
    const creator = await db.prepare(
      'SELECT plan FROM creators WHERE id = ?'
    ).bind(creatorId).first<{ plan: string }>()

    if (creator?.plan === 'free') {
      const count = await db.prepare(
        'SELECT COUNT(*) as n FROM gates WHERE creator_id = ?'
      ).bind(creatorId).first<{ n: number }>()
      if ((count?.n ?? 0) >= 1) {
        return c.json({ error: 'Free plan limited to 1 gate. Upgrade to Pro for unlimited gates.' }, 403)
      }
    }

    // Check slug unique
    const existing = await db.prepare(
      'SELECT id FROM gates WHERE slug = ?'
    ).bind(data.slug).first()
    if (existing) return c.json({ error: 'Slug already taken' }, 409)

    const id = cuid()
    await db.prepare(`
      INSERT INTO gates (id, creator_id, slug, name, tagline, unlock_price_cents,
        contact_url, faq_url, faqs, show_brand)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id, creatorId, data.slug, data.name, data.tagline,
      data.unlock_price_cents, data.contact_url, data.faq_url,
      JSON.stringify(data.faqs), data.show_brand ? 1 : 0
    ).run()

    const gate = await db.prepare('SELECT * FROM gates WHERE id = ?').bind(id).first<Gate>()
    return c.json({ ...gate!, faqs: JSON.parse(gate!.faqs) }, 201)
  }
)

// ── AUTHED: PATCH /gates/:id — update a gate ─────────────────────────────────
gates.patch(
  '/:id',
  zValidator('json', gateUpdateSchema),
  async (c) => {
    const creatorId = await requireAuth(c)
    if (typeof creatorId !== 'string') return creatorId

    const { id } = c.req.param()
    const data = c.req.valid('json')
    const db = c.env.DB

    // Ownership check
    const gate = await db.prepare(
      'SELECT id, creator_id FROM gates WHERE id = ?'
    ).bind(id).first<{ id: string; creator_id: string }>()
    if (!gate) return c.json({ error: 'Not found' }, 404)
    if (gate.creator_id !== creatorId) return c.json({ error: 'Forbidden' }, 403)

    // Build dynamic SET clause
    const fields: string[] = []
    const vals: unknown[] = []

    if (data.name !== undefined)               { fields.push('name = ?');                vals.push(data.name) }
    if (data.tagline !== undefined)            { fields.push('tagline = ?');             vals.push(data.tagline) }
    if (data.unlock_price_cents !== undefined) { fields.push('unlock_price_cents = ?');  vals.push(data.unlock_price_cents) }
    if (data.contact_url !== undefined)        { fields.push('contact_url = ?');         vals.push(data.contact_url) }
    if (data.faq_url !== undefined)            { fields.push('faq_url = ?');             vals.push(data.faq_url) }
    if (data.faqs !== undefined)               { fields.push('faqs = ?');                vals.push(JSON.stringify(data.faqs)) }
    if (data.show_brand !== undefined)         { fields.push('show_brand = ?');          vals.push(data.show_brand ? 1 : 0) }
    if (data.is_live !== undefined)            { fields.push('is_live = ?');             vals.push(data.is_live ? 1 : 0) }

    if (fields.length === 0) return c.json({ error: 'No fields to update' }, 400)

    fields.push('updated_at = ?')
    vals.push(Date.now())
    vals.push(id)

    await db.prepare(
      `UPDATE gates SET ${fields.join(', ')} WHERE id = ?`
    ).bind(...vals).run()

    const updated = await db.prepare('SELECT * FROM gates WHERE id = ?').bind(id).first<Gate>()
    return c.json({ ...updated!, faqs: JSON.parse(updated!.faqs) })
  }
)

// ── AUTHED: DELETE /gates/:id ─────────────────────────────────────────────────
gates.delete('/:id', async (c) => {
  const creatorId = await requireAuth(c)
  if (typeof creatorId !== 'string') return creatorId

  const { id } = c.req.param()
  const db = c.env.DB

  const gate = await db.prepare(
    'SELECT creator_id FROM gates WHERE id = ?'
  ).bind(id).first<{ creator_id: string }>()
  if (!gate) return c.json({ error: 'Not found' }, 404)
  if (gate.creator_id !== creatorId) return c.json({ error: 'Forbidden' }, 403)

  await db.prepare('DELETE FROM gates WHERE id = ?').bind(id).run()
  return c.json({ ok: true })
})

// ── AUTHED: GET /gates/:id/analytics — dashboard stats ───────────────────────
gates.get('/:id/analytics', async (c) => {
  const creatorId = await requireAuth(c)
  if (typeof creatorId !== 'string') return creatorId

  const { id } = c.req.param()
  const days = parseInt(c.req.query('days') ?? '14')
  const db = c.env.DB

  const gate = await db.prepare(
    'SELECT creator_id FROM gates WHERE id = ?'
  ).bind(id).first<{ creator_id: string }>()
  if (!gate) return c.json({ error: 'Not found' }, 404)
  if (gate.creator_id !== creatorId) return c.json({ error: 'Forbidden' }, 403)

  // Views + unlocks per day
  const { results: daily } = await db.prepare(`
    SELECT day,
      SUM(CASE WHEN event = 'view' THEN 1 ELSE 0 END) as views,
      SUM(CASE WHEN event = 'unlock_complete' THEN 1 ELSE 0 END) as unlocks
    FROM gate_events
    WHERE gate_id = ?
      AND day >= date('now', ? || ' days')
    GROUP BY day ORDER BY day ASC
  `).bind(id, `-${days}`).all()

  // Total earnings
  const earnings = await db.prepare(`
    SELECT
      SUM(amount_cents) as total_cents,
      SUM(creator_payout_cents) as creator_cents,
      COUNT(*) as total_unlocks
    FROM verifications
    WHERE gate_id = ? AND status = 'completed'
  `).bind(id).first<{ total_cents: number; creator_cents: number; total_unlocks: number }>()

  return c.json({ daily, earnings })
})
