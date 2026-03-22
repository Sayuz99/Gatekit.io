(function() {
  'use strict';

  // ── Config ─────────────────────────────────────────────────────────────────
  const script = document.currentScript || document.querySelector('script[data-id]');
  const GATE_ID = script?.getAttribute('data-id') || 'demo';
  const UNLOCK_PRICE = parseFloat(script?.getAttribute('data-price') || '1');
  const BRAND = script?.getAttribute('data-brand') !== 'false';
  const API_BASE = script?.getAttribute('data-api') || 'https://api.gatekit.io';
  const STORAGE_KEY = 'gk_verified_' + GATE_ID;

  // ── Verified check ──────────────────────────────────────────────────────────
  function isVerified() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const { token, exp } = JSON.parse(raw);
      return token && Date.now() < exp;
    } catch { return false; }
  }

  function setVerified(token) {
    try {
      const exp = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, exp }));
    } catch {}
  }

  // ── Gate data (fetched or inline demo) ─────────────────────────────────────
  let gateData = null;

  async function fetchGate() {
    try {
      const res = await fetch(API_BASE + '/gate/' + GATE_ID);
      if (!res.ok) throw new Error('not found');
      gateData = await res.json();
    } catch {
      // Fallback demo data (replace with real API)
      gateData = {
        name: 'Marc',
        tagline: 'I build TrustMRR solo — no team, no VC',
        price: UNLOCK_PRICE,
        contact_url: 'mailto:marc@example.com',
        faq_url: 'https://example.com/faq',
        checkout_url: 'https://buy.stripe.com/demo',
        faqs: [
          { q: 'How does the $1 unlock work?', a: 'A one-time $1 payment gives you lifetime access to direct support. It\'s a spam filter, not a subscription.' },
          { q: 'I\'m already a paying customer — do I need to pay again?', a: 'No. Just mention your order email when you reach out and we\'ll verify it manually.' },
          { q: 'How fast do you respond?', a: 'Usually within 24 hours on weekdays. No bots — you get a reply from me directly.' },
          { q: 'What if my question isn\'t answered here?', a: 'Unlock support for $1 and send your question. I\'ll get back to you.' },
        ]
      };
    }
    return gateData;
  }

  // ── Styles ──────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('gk-styles')) return;
    const style = document.createElement('style');
    style.id = 'gk-styles';
    style.textContent = `
      #gk-overlay {
        position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(0,0,0,0.55);
        display: flex; align-items: center; justify-content: center;
        padding: 16px;
        opacity: 0; transition: opacity 0.2s ease;
        backdrop-filter: blur(4px);
        font-family: -apple-system, 'Segoe UI', sans-serif;
      }
      #gk-overlay.gk-visible { opacity: 1; }

      #gk-modal {
        background: #ffffff;
        border-radius: 14px;
        padding: 28px;
        max-width: 420px; width: 100%;
        position: relative;
        transform: translateY(12px) scale(0.98);
        transition: transform 0.25s cubic-bezier(0.34,1.56,0.64,1);
        max-height: 90vh; overflow-y: auto;
        box-shadow: 0 24px 64px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(0,0,0,0.08);
      }
      #gk-overlay.gk-visible #gk-modal {
        transform: translateY(0) scale(1);
      }

      #gk-close {
        position: absolute; top: 14px; right: 14px;
        width: 28px; height: 28px; border-radius: 50%;
        border: none; background: #f0efeb; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        color: #666; font-size: 14px; line-height: 1;
        transition: background 0.15s;
      }
      #gk-close:hover { background: #e4e3df; }

      .gk-header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 18px; }
      .gk-avatar {
        width: 42px; height: 42px; border-radius: 50%; flex-shrink: 0;
        background: #e8f4fd; display: flex; align-items: center; justify-content: center;
        font-size: 15px; font-weight: 600; color: #1a6fa8;
        border: 1.5px solid rgba(0,0,0,0.06);
      }
      .gk-header-text h3 { font-size: 15px; font-weight: 600; color: #0a0a08; margin: 0 0 2px; }
      .gk-header-text p { font-size: 12px; color: #888; margin: 0; }

      .gk-body { font-size: 13.5px; color: #555; line-height: 1.65; margin-bottom: 16px; }

      .gk-hint {
        background: #f7f6f2; border-radius: 8px; padding: 11px 14px;
        font-size: 12.5px; color: #777; line-height: 1.55; margin-bottom: 20px;
      }

      /* FAQ */
      .gk-faq { border-top: 1px solid #f0efeb; margin-bottom: 20px; }
      .gk-faq-item { border-bottom: 1px solid #f0efeb; }
      .gk-faq-q {
        width: 100%; background: none; border: none; cursor: pointer;
        display: flex; justify-content: space-between; align-items: center;
        padding: 12px 0; text-align: left;
        font-size: 13px; font-weight: 500; color: #1a1a18;
        gap: 8px;
      }
      .gk-faq-q:hover { color: #000; }
      .gk-faq-chevron {
        flex-shrink: 0; width: 16px; height: 16px; color: #aaa;
        transition: transform 0.2s; display: flex; align-items: center; justify-content: center;
      }
      .gk-faq-chevron svg { width: 12px; height: 12px; }
      .gk-faq-item.gk-open .gk-faq-chevron { transform: rotate(180deg); }
      .gk-faq-a {
        display: none; font-size: 13px; color: #666; line-height: 1.65;
        padding: 0 0 14px; padding-right: 24px;
      }
      .gk-faq-item.gk-open .gk-faq-a { display: block; }

      /* Search */
      .gk-search {
        width: 100%; padding: 9px 12px; margin: 14px 0 0;
        border: 1px solid #e8e7e3; border-radius: 7px;
        font-size: 13px; color: #1a1a18; outline: none;
        background: #fafaf8;
        transition: border-color 0.15s;
        box-sizing: border-box;
      }
      .gk-search:focus { border-color: #b0b0a8; background: #fff; }
      .gk-search::placeholder { color: #bbb; }

      /* Buttons */
      .gk-actions { display: flex; flex-direction: column; gap: 8px; }
      .gk-btn {
        width: 100%; padding: 12px 16px; border-radius: 8px;
        font-size: 13.5px; font-weight: 500; cursor: pointer;
        transition: all 0.15s; display: flex; align-items: center; justify-content: center;
        gap: 6px; border: none; text-decoration: none;
      }
      .gk-btn-secondary {
        background: #f0efeb; color: #555;
      }
      .gk-btn-secondary:hover { background: #e8e7e3; color: #222; }
      .gk-btn-primary {
        background: #0a0a08; color: #fff;
      }
      .gk-btn-primary:hover { background: #222; }
      .gk-btn-primary.gk-loading { opacity: 0.6; pointer-events: none; }

      .gk-footer-note {
        text-align: center; font-size: 11px; color: #bbb;
        margin-top: 14px; line-height: 1.5;
      }
      .gk-brand {
        text-align: center; font-size: 10.5px; color: #ccc;
        margin-top: 10px;
      }
      .gk-brand a { color: #aaa; text-decoration: none; }
      .gk-brand a:hover { color: #666; }

      /* Verified state */
      #gk-verified-view { text-align: center; padding: 12px 0; }
      .gk-verified-badge {
        display: inline-flex; align-items: center; gap: 6px;
        background: #eaf3de; color: #3B6D11; font-size: 13px; font-weight: 500;
        padding: 8px 14px; border-radius: 20px; margin-bottom: 14px;
      }
      .gk-verified-badge svg { width: 14px; height: 14px; }

      /* Dark mode */
      @media (prefers-color-scheme: dark) {
        #gk-modal {
          background: #1a1a18;
          box-shadow: 0 24px 64px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.08);
        }
        #gk-close { background: #2a2a28; color: #aaa; }
        #gk-close:hover { background: #333330; }
        .gk-header-text h3 { color: #f5f4ef; }
        .gk-header-text p { color: #666; }
        .gk-body { color: #888; }
        .gk-hint { background: #222220; color: #666; }
        .gk-faq { border-top-color: #2a2a28; }
        .gk-faq-item { border-bottom-color: #2a2a28; }
        .gk-faq-q { color: #e0e0dc; }
        .gk-faq-q:hover { color: #fff; }
        .gk-faq-a { color: #777; }
        .gk-search { background: #222220; border-color: #333330; color: #e0e0dc; }
        .gk-search:focus { border-color: #555550; background: #2a2a28; }
        .gk-btn-secondary { background: #2a2a28; color: #888; }
        .gk-btn-secondary:hover { background: #333330; color: #ccc; }
        .gk-btn-primary { background: #f5f4ef; color: #0a0a08; }
        .gk-btn-primary:hover { background: #e0e0dc; }
        .gk-footer-note { color: #444; }
        .gk-brand { color: #333; }
        .gk-brand a { color: #444; }
        .gk-avatar { background: #1e3a4f; color: #5aaee8; }
        .gk-verified-badge { background: #1a2e10; color: #7ab84a; }
      }

      /* Trigger button (optional) */
      .gk-trigger {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 10px 18px; border-radius: 7px;
        background: #0a0a08; color: #fff;
        font-size: 13.5px; font-weight: 500; cursor: pointer;
        border: none; font-family: inherit;
        transition: background 0.15s;
      }
      .gk-trigger:hover { background: #222; }
    `;
    document.head.appendChild(style);
  }

  // ── Build modal HTML ────────────────────────────────────────────────────────
  function buildModal(data) {
    const price = data.price || UNLOCK_PRICE;
    const initials = (data.name || 'G').split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);

    const faqItems = (data.faqs || []).map((f, i) => `
      <div class="gk-faq-item" data-idx="${i}">
        <button class="gk-faq-q" aria-expanded="false">
          <span>${escHtml(f.q)}</span>
          <span class="gk-faq-chevron">
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
              <path d="M2 4l4 4 4-4"/>
            </svg>
          </span>
        </button>
        <div class="gk-faq-a">${escHtml(f.a)}</div>
      </div>
    `).join('');

    const brandHtml = BRAND
      ? `<p class="gk-brand">Filtered by <a href="https://gatekit.io" target="_blank" rel="noopener">GateKit</a></p>`
      : '';

    return `
      <div id="gk-overlay" role="dialog" aria-modal="true" aria-label="Support gate">
        <div id="gk-modal">
          <button id="gk-close" aria-label="Close">✕</button>

          <!-- Default view -->
          <div id="gk-default-view">
            <div class="gk-header">
              <div class="gk-avatar">${initials}</div>
              <div class="gk-header-text">
                <h3>Hey, it's ${escHtml(data.name)} 👋</h3>
                <p>${escHtml(data.tagline || '')}</p>
              </div>
            </div>

            <p class="gk-body">
              I build this solo and want to keep it lean. To keep response quality high,
              direct support is reserved for paying customers.
            </p>

            <div class="gk-hint">
              The $1 filters spam — not people. Paying customers get fast, direct replies.
            </div>

            ${faqItems.length ? `
              <p style="font-size:12px;color:#aaa;margin-bottom:0">Most questions are already answered in the FAQ ↓</p>
              <input type="search" class="gk-search" placeholder="Search FAQ…" aria-label="Search FAQ" autocomplete="off">
              <div class="gk-faq">${faqItems}</div>
            ` : ''}

            <div class="gk-actions">
              ${data.faq_url ? `<a href="${escAttr(data.faq_url)}" target="_blank" rel="noopener" class="gk-btn gk-btn-secondary">Browse full FAQ →</a>` : ''}
              <button id="gk-unlock-btn" class="gk-btn gk-btn-primary">
                Unlock support for $${price} →
              </button>
            </div>

            <p class="gk-footer-note">Existing paid customers automatically get access.</p>
            ${brandHtml}
          </div>

          <!-- Verified view (shown when already unlocked) -->
          <div id="gk-verified-view" style="display:none">
            <div class="gk-verified-badge">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M13 4L6 11 3 8"/>
              </svg>
              Support unlocked
            </div>
            <p style="font-size:14px;color:#555;margin-bottom:20px;line-height:1.65">
              You have direct support access. ${data.name} will get back to you within 24 hours.
            </p>
            <a href="${escAttr(data.contact_url || '#')}" class="gk-btn gk-btn-primary">
              Send your message →
            </a>
            ${brandHtml}
          </div>

        </div>
      </div>
    `;
  }

  // ── Escape helpers ──────────────────────────────────────────────────────────
  function escHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function escAttr(str) { return escHtml(str); }

  // ── Mount modal ─────────────────────────────────────────────────────────────
  let overlay = null;
  let mounted = false;

  function mount(data) {
    if (mounted) return;
    mounted = true;
    const div = document.createElement('div');
    div.innerHTML = buildModal(data);
    overlay = div.firstElementChild;
    document.body.appendChild(overlay);
    bindEvents(data);
  }

  // ── Open / close ────────────────────────────────────────────────────────────
  function open() {
    if (!overlay) return;

    // Show correct view
    const verified = isVerified();
    document.getElementById('gk-default-view').style.display = verified ? 'none' : 'block';
    document.getElementById('gk-verified-view').style.display = verified ? 'block' : 'none';

    overlay.style.display = 'flex';
    requestAnimationFrame(() => overlay.classList.add('gk-visible'));
    document.body.style.overflow = 'hidden';
    document.getElementById('gk-modal')?.focus();
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('gk-visible');
    document.body.style.overflow = '';
    setTimeout(() => { overlay.style.display = 'none'; }, 220);
  }

  // ── Events ──────────────────────────────────────────────────────────────────
  function bindEvents(data) {
    // Close button
    document.getElementById('gk-close').addEventListener('click', close);

    // Click outside
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Escape key
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    // FAQ accordion
    overlay.querySelectorAll('.gk-faq-q').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.gk-faq-item');
        const isOpen = item.classList.contains('gk-open');
        overlay.querySelectorAll('.gk-faq-item').forEach(i => i.classList.remove('gk-open'));
        if (!isOpen) item.classList.add('gk-open');
        btn.setAttribute('aria-expanded', String(!isOpen));
      });
    });

    // FAQ search
    const searchInput = overlay.querySelector('.gk-search');
    if (searchInput) {
      searchInput.addEventListener('input', e => {
        const q = e.target.value.toLowerCase().trim();
        overlay.querySelectorAll('.gk-faq-item').forEach(item => {
          const text = item.querySelector('.gk-faq-q span').textContent.toLowerCase()
                     + item.querySelector('.gk-faq-a').textContent.toLowerCase();
          item.style.display = (!q || text.includes(q)) ? '' : 'none';
        });
      });
    }

    // Unlock button → Stripe checkout
    const unlockBtn = document.getElementById('gk-unlock-btn');
    if (unlockBtn) {
      unlockBtn.addEventListener('click', async () => {
        unlockBtn.classList.add('gk-loading');
        unlockBtn.textContent = 'Redirecting…';

        try {
          // In production: create a Stripe Checkout Session via your API,
          // then redirect to the returned URL. Return URL should include
          // ?gk_token=TOKEN so gate.js can verify and store it.
          const checkoutUrl = data.checkout_url
            || `${API_BASE}/checkout?gate=${GATE_ID}&return_url=${encodeURIComponent(window.location.href)}`;
          window.location.href = checkoutUrl;
        } catch {
          unlockBtn.classList.remove('gk-loading');
          unlockBtn.textContent = `Unlock support for $${data.price || UNLOCK_PRICE} →`;
        }
      });
    }

    // Handle return from Stripe (check URL for token)
    checkReturnToken();
  }

  function checkReturnToken() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('gk_token');
    const gateParam = params.get('gk_gate');
    if (token && (!gateParam || gateParam === GATE_ID)) {
      setVerified(token);
      // Clean URL
      params.delete('gk_token');
      params.delete('gk_gate');
      const clean = [window.location.pathname, params.toString()].filter(Boolean).join('?');
      history.replaceState({}, '', clean);
      // Auto-open to show verified state
      open();
    }
  }

  // ── Auto-attach triggers ────────────────────────────────────────────────────
  function attachTriggers() {
    // Any element with data-gk-trigger
    document.querySelectorAll('[data-gk-trigger]').forEach(el => {
      el.addEventListener('click', e => { e.preventDefault(); open(); });
    });
    // Any link pointing to gatekit.io/GATE_ID
    document.querySelectorAll(`a[href*="gatekit.io/${GATE_ID}"]`).forEach(el => {
      el.addEventListener('click', e => { e.preventDefault(); open(); });
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────────
  window.GateKit = { open, close, isVerified };

  // ── Init ────────────────────────────────────────────────────────────────────
  async function init() {
    injectStyles();
    const data = await fetchGate();
    mount(data);
    attachTriggers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
