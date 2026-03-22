import type { Env } from './types'
import type { Context } from 'hono'

// ── CUID2-lite (no npm dep, CF Workers compatible) ───────────────────────────
const CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function cuid(): string {
  const ts = Date.now().toString(36)
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => CHARS[b % CHARS.length])
    .join('')
  return 'c' + ts + rand
}

// ── Random token (for magic links + verification tokens) ─────────────────────
export function randomToken(bytes = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Minimal JWT (HS256) — no library needed on Workers ───────────────────────
async function importKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder()
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  )
}

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function b64urlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  return new Uint8Array([...bin].map(c => c.charCodeAt(0)))
}

export async function signJWT(
  payload: Record<string, unknown>,
  secret: string,
  expiresInSec = 60 * 60 * 24 * 7   // 7 days
): Promise<string> {
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body   = b64url(new TextEncoder().encode(JSON.stringify({
    ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + expiresInSec
  })))
  const key = await importKey(secret)
  const sig = b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`)))
  return `${header}.${body}.${sig}`
}

export async function verifyJWT(
  token: string,
  secret: string
): Promise<Record<string, unknown> | null> {
  try {
    const [header, body, sig] = token.split('.')
    if (!header || !body || !sig) return null
    const key = await importKey(secret)
    const valid = await crypto.subtle.verify(
      'HMAC', key,
      b64urlDecode(sig),
      new TextEncoder().encode(`${header}.${body}`)
    )
    if (!valid) return null
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body)))
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

// ── Auth middleware helper ────────────────────────────────────────────────────
export async function getCreatorFromJWT(
  c: Context<{ Bindings: Env }>,
  authHeader: string | null
): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const payload = await verifyJWT(token, c.env.JWT_SECRET)
  if (!payload || typeof payload.sub !== 'string') return null
  return payload.sub  // creator id
}

// ── Slug validation ───────────────────────────────────────────────────────────
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)
}

// ── Price formatting ──────────────────────────────────────────────────────────
export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`
}

// ── Today string ─────────────────────────────────────────────────────────────
export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// ── CORS headers ─────────────────────────────────────────────────────────────
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

// ── Resend email helper ───────────────────────────────────────────────────────
export async function sendEmail(opts: {
  apiKey: string
  to: string
  subject: string
  html: string
}): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'GateKit <noreply@gatekit.io>',
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    console.error('Resend error:', err)
  }
}

// ── Stripe signature verification ─────────────────────────────────────────────
export async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string
): Promise<boolean> {
  try {
    const pairs = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')))
    const ts = pairs['t']
    const v1 = pairs['v1']
    if (!ts || !v1) return false

    // Reject events older than 5 minutes
    if (Math.abs(Date.now() / 1000 - parseInt(ts)) > 300) return false

    const signed = `${ts}.${payload}`
    const key = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed))
    const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
    return expected === v1
  } catch {
    return false
  }
}
