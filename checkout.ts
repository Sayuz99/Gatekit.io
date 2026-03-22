import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import type { Env, Gate, Verification } from '../types'
import { cuid, randomToken, verifyStripeSignature, sendEmail, today } from '../utils'

export const checkout = new Hono<{ Bindings: Env }>()

// ── POST /checkout/session — create a Stripe Checkout Session ─────────────────
// Called by gate.js when visitor clicks "Unlock support for $X"
checkout.post(
  '/session',
  zValidator('json', z.object({
    gate_slug:   z.string(),
    return_url:  z.string().url(),
    email:       z.string().email().optional(),
  })),
  async (c) => {
    const { gate_slug, return_url, email } = c.req.valid('json')
    const db = c.env.DB

    const gate = await db.prepare(
      'SELECT * FROM gates WHERE slug = ? AND is_live = 1'
    ).bind(gate_slug).first<Gate>()

    if (!gate) return c.json({ error: 'Gate not found' }, 404)

    // Create a pending verification record with a token
    const token = randomToken(40)
    const verifId = cuid()
    const creatorPayoutCents = Math.floor(gate.unlock_price_cents * 0.85)
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000  // 30 days

    await db.prepare(`
      INSERT INTO verifications (id, gate_id, token, email, amount_cents, creator_payout_cents, status, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
    `).bind(verifId, gate.id, token, email ?? null, gate.unlock_price_cents, creatorPayoutCents, expiresAt).run()

    // Track unlock_start event
    c.executionCtx.waitUntil(
      db.prepare(
        'INSERT INTO gate_events (id, gate_id, event, day) VALUES (?, ?, ?, ?)'
      ).bind(cuid(), gate.id, 'unlock_start', today()).run()
    )

    // Build Stripe Checkout Session
    // Return URL includes gk_token so gate.js can detect and store it
    const successUrl = `${return_url}${return_url.includes('?') ? '&' : '?'}gk_token=${token}&gk_gate=${gate_slug}`

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${c.env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'mode':                                  'payment',
        'success_url':                           successUrl,
        'cancel_url':                            return_url,
        'line_items[0][price_data][currency]':   'usd',
        'line_items[0][price_data][unit_amount]': String(gate.unlock_price_cents),
        'line_items[0][price_data][product_data][name]': `Support access — ${gate.name}`,
        'line_items[0][price_data][product_data][description]': `Unlock direct support from ${gate.name}`,
        'line_items[0][quantity]':               '1',
        'metadata[verif_id]':                    verifId,
        'metadata[gate_id]':                     gate.id,
        'metadata[gate_slug]':                   gate_slug,
        ...(email ? { 'customer_email': email } : {}),
        // Stripe Connect: send funds to creator's account
        ...(await getTransferData(gate, c.env.DB, creatorPayoutCents)),
      }).toString(),
    })

    if (!stripeRes.ok) {
      const err = await stripeRes.json() as { error: { message: string } }
      console.error('Stripe error:', err)
      return c.json({ error: 'Payment setup failed' }, 502)
    }

    const session = await stripeRes.json() as { url: string; id: string }

    // Store session id for webhook reconciliation
    await db.prepare(
      'UPDATE verifications SET stripe_payment_id = ? WHERE id = ?'
    ).bind(session.id, verifId).run()

    return c.json({ checkout_url: session.url })
  }
)

// Helper: get Stripe transfer data if creator has Connect account
async function getTransferData(
  gate: Gate,
  db: D1Database,
  creatorPayoutCents: number
): Promise<Record<string, string>> {
  const creator = await db.prepare(
    'SELECT stripe_account_id FROM creators WHERE id = ?'
  ).bind(gate.creator_id).first<{ stripe_account_id: string | null }>()

  if (!creator?.stripe_account_id) return {}

  return {
    'transfer_data[destination]': creator.stripe_account_id,
    'transfer_data[amount]':      String(creatorPayoutCents),
  }
}

// ── GET /checkout/verify?token=xxx — gate.js calls this to validate a token ──
checkout.get('/verify', async (c) => {
  const token = c.req.query('token')
  const slug  = c.req.query('gate')

  if (!token) return c.json({ valid: false, error: 'Missing token' }, 400)

  const db = c.env.DB
  const verif = await db.prepare(`
    SELECT v.*, g.slug
    FROM verifications v
    JOIN gates g ON g.id = v.gate_id
    WHERE v.token = ? AND v.status = 'completed' AND v.expires_at > ?
  `).bind(token, Date.now()).first<Verification & { slug: string }>()

  if (!verif) return c.json({ valid: false })
  if (slug && verif.slug !== slug) return c.json({ valid: false })

  return c.json({ valid: true, expires_at: verif.expires_at })
})

// ── POST /checkout/webhook — Stripe sends events here ────────────────────────
checkout.post('/webhook', async (c) => {
  const body = await c.req.text()
  const sig  = c.req.header('stripe-signature') ?? ''

  const valid = await verifyStripeSignature(body, sig, c.env.STRIPE_WEBHOOK_SECRET)
  if (!valid) return c.json({ error: 'Invalid signature' }, 400)

  const event = JSON.parse(body) as { type: string; data: { object: Record<string, unknown> } }
  const db = c.env.DB

  // Handle relevant events
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    const verifId = session['metadata'] && (session['metadata'] as Record<string, string>)['verif_id']
    if (!verifId) return c.json({ ok: true })

    // Mark verification completed
    await db.prepare(`
      UPDATE verifications SET status = 'completed', stripe_payment_id = ? WHERE id = ?
    `).bind(session['id'], verifId).run()

    // Fetch verif to get gate + email
    const verif = await db.prepare(`
      SELECT v.*, g.name as gate_name, c.email as creator_email
      FROM verifications v
      JOIN gates g ON g.id = v.gate_id
      JOIN creators c ON c.id = g.creator_id
      WHERE v.id = ?
    `).bind(verifId).first<Verification & { gate_name: string; creator_email: string }>()

    if (!verif) return c.json({ ok: true })

    // Track analytics event
    c.executionCtx.waitUntil(
      db.prepare(
        'INSERT INTO gate_events (id, gate_id, event, day) VALUES (?, ?, ?, ?)'
      ).bind(cuid(), verif.gate_id, 'unlock_complete', today()).run()
    )

    // Email the visitor their confirmation
    const visitorEmail = (session['customer_details'] as any)?.email ?? verif.email
    if (visitorEmail) {
      c.executionCtx.waitUntil(
        sendEmail({
          apiKey: c.env.RESEND_API_KEY,
          to: visitorEmail,
          subject: `Support unlocked — ${verif.gate_name}`,
          html: `
            <div style="font-family:monospace;max-width:480px;margin:40px auto;color:#1a1a18">
              <p style="font-size:18px;font-weight:500;margin-bottom:8px">You're in ✓</p>
              <p style="color:#555;margin-bottom:20px;line-height:1.6">
                Your support access for <strong>${verif.gate_name}</strong> is now active.
                You'll receive a direct reply within 24 hours.
              </p>
              <p style="color:#aaa;font-size:12px">Your access expires in 30 days. Amount charged: ${formatCents(verif.amount_cents)}.</p>
            </div>
          `,
        })
      )
    }

    // Notify the creator
    c.executionCtx.waitUntil(
      sendEmail({
        apiKey: c.env.RESEND_API_KEY,
        to: verif.creator_email,
        subject: `New support unlock — ${formatCents(verif.creator_payout_cents)} incoming`,
        html: `
          <div style="font-family:monospace;max-width:480px;margin:40px auto;color:#1a1a18">
            <p style="font-size:18px;font-weight:500;margin-bottom:8px">Someone unlocked your gate</p>
            <p style="color:#555;margin-bottom:8px">Gate: <strong>${verif.gate_name}</strong></p>
            ${visitorEmail ? `<p style="color:#555;margin-bottom:8px">From: ${visitorEmail}</p>` : ''}
            <p style="color:#555;margin-bottom:20px">Your payout: <strong style="color:#3B6D11">${formatCents(verif.creator_payout_cents)}</strong></p>
            <a href="https://app.gatekit.io/dashboard" style="background:#d4f060;color:#0a0a08;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500">View dashboard →</a>
          </div>
        `,
      })
    )
  }

  if (event.type === 'charge.refunded') {
    const charge = event.data.object
    await db.prepare(`
      UPDATE verifications SET status = 'refunded'
      WHERE stripe_payment_id = ?
    `).bind(charge['payment_intent']).run()
  }

  return c.json({ ok: true })
})

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}
