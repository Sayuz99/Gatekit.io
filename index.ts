import { Hono } from 'hono'
import type { Env } from './types'
import { CORS_HEADERS } from './utils'
import { auth }     from './routes/auth'
import { gates }    from './routes/gates'
import { checkout } from './routes/checkout'
import { events }   from './routes/events'
import { creators } from './routes/creators'

const app = new Hono<{ Bindings: Env }>()

// ── CORS preflight ─────────────────────────────────────────────────────────
app.options('*', (c) => c.text('', 204, CORS_HEADERS))

// ── CORS headers on all responses ─────────────────────────────────────────
app.use('*', async (c, next) => {
  await next()
  Object.entries(CORS_HEADERS).forEach(([k, v]) => c.res.headers.set(k, v))
})

// ── Health check ──────────────────────────────────────────────────────────
app.get('/', (c) => c.json({
  service: 'GateKit API',
  version: '1.0.0',
  status:  'ok',
}))

app.get('/health', (c) => c.json({ ok: true, ts: Date.now() }))

// ── Routes ────────────────────────────────────────────────────────────────
app.route('/auth',     auth)
app.route('/gates',    gates)
app.route('/checkout', checkout)
app.route('/events',   events)
app.route('/creators', creators)

// ── 404 catch-all ─────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not found', path: c.req.path }, 404))

// ── Global error handler ──────────────────────────────────────────────────
app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
