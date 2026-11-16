/* TacticalTails storefront — no platform, no dependencies.
   Everything comes from data/catalog.json. Checkout hands off to AltCheckout via /api/checkout. */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const PH = 'images/placeholder.svg';
  const CART_KEY = 'tt_cart_v2';
  let CAT = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (c) => new Intl.NumberFormat('en-US', { style: 'currency', currency: CAT?.store.currency || 'USD' }).format(c / 100);
  const img = (src, alt = '', cls = '', lazy = true) => `<img src="${esc(src || PH)}" alt="${esc(alt)}" class="${cls}" ${lazy ? 'loading="lazy"' : ''} onerror="this.onerror=null;this.src='${PH}'">`;

  /* ---------- icons ---------- */
  const I = {
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8"/></svg>',
    bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 8h14l-1 13H6L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="m7.5 12.5 3 3 6-7"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 9 6 6 6-6"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m15 5-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m9 5 7 7-7 7"/></svg>',
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="m5 15 7-7 7 7"/></svg>',
    tag: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 12.6V4a1 1 0 0 1 1-1h8.6a1 1 0 0 1 .7.3l7.4 7.4a1 1 0 0 1 0 1.4l-8.6 8.6a1 1 0 0 1-1.4 0L3.3 13.3a1 1 0 0 1-.3-.7ZM8 9.5A1.5 1.5 0 1 0 8 6.5a1.5 1.5 0 0 0 0 3Z"/></svg>',
    quote: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 7H6.5A2.5 2.5 0 0 0 4 9.5V13a2 2 0 0 0 2 2h2.2c-.2 1.3-1 2.3-2.4 3l.9 1.6C9.6 18.4 11 16.2 11 13V8a1 1 0 0 0-1-1Zm9 0h-3.5A2.5 2.5 0 0 0 13 9.5V13a2 2 0 0 0 2 2h2.2c-.2 1.3-1 2.3-2.4 3l.9 1.6c2.9-1.2 4.3-3.4 4.3-6.6V8a1 1 0 0 0-1-1Z"/></svg>',
  };
  const PAY = [['american_express', 'American Express'], ['apple_pay', 'Apple Pay'], ['diners_club', 'Diners Club'], ['discover', 'Discover'], ['google_pay', 'Google Pay'], ['master', 'Mastercard'], ['cashapppay', 'Cash App Pay'], ['visa', 'Visa']];
  const payBadges = () => `<div class="pay">${PAY.map(([f, t]) => `<img src="images/pay/${f}.svg" alt="${t}" width="38" height="24" loading="lazy">`).join('')}</div>`;
  const stars = (n = 5) => `<span class="stars">${'★'.repeat(n)}</span>`;

  /* ---------- catalog helpers ---------- */
  const product = (h) => CAT.products.find((p) => p.handle === h);
  const optVal = (p, name, val) => p.options.find((o) => o.name === name)?.values.find((v) => v.name === val);
  const unitImage = (p, opts) => { for (const o of p.options) { const v = optVal(p, o.name, opts[o.name]); if (v?.image) return v.image; } return p.images?.[0] || PH; };
  const isSoldOut = (p, opts) => (p.sold_out || []).some((combo) => Object.entries(combo).every(([k, v]) => opts[k] === v));
  const optsLabel = (o) => Object.values(o).join(' / ');

  /* line = { handle, tier, units:[{Size,Variant}], addons:[id], gifts:[id], qty } */
  function linePrice(l) {
    const p = product(l.handle); if (!p) return 0;
    const b = p.bundles, t = b?.tiers.find((x) => x.id === l.tier);
    let c = t ? t.price_cents : p.price_cents;
    for (const a of l.addons || []) c += b?.addons?.find((x) => x.id === a)?.price_cents || 0;
    return c;
  }

  /* ---------- cart ---------- */
  let mem = [];
  const readCart = () => { try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return mem; } };
  const writeCart = (c) => { mem = c; try { localStorage.setItem(CART_KEY, JSON.stringify(c)); } catch {} renderCart(); };
  const sig = (l) => JSON.stringify([l.handle, l.tier, l.units, [...(l.addons || [])].sort(), [...(l.gifts || [])].sort()]);
  function addLine(line) {
    const c = readCart().filter((l) => product(l.handle));
    const ex = c.find((l) => sig(l) === sig(line));
    if (ex) ex.qty = Math.min(10, ex.qty + 1); else c.push({ ...line, qty: 1 });
    writeCart(c); openDrawer();
    const pr = product(line.handle);
    window.ttPixel?.track('AddToCart', { content_ids: [line.handle], content_type: 'product', content_name: pr?.title, value: linePrice(line) / 100, currency: 'USD', num_items: 1 });
  }
  const cartLines = () => readCart().filter((l) => product(l.handle) && Array.isArray(l.units));

  /* ---------- page chrome ---------- */
  const wave = (dir) => `<div class="wave ${dir}" aria-hidden="true"><svg viewBox="0 0 1440 90" preserveAspectRatio="none"><path class="w-back" d="M0 43.9 L24 45.1 L48 46.1 L72 47.1 L96 47.9 L120 48.6 L144 49.2 L168 49.6 L192 49.9 L216 50.0 L240 50.0 L264 49.8 L288 49.4 L312 48.9 L336 48.3 L360 47.6 L384 46.7 L408 45.7 L432 44.5 L456 43.3 L480 42.1 L504 40.7 L528 39.3 L552 37.9 L576 36.4 L600 34.9 L624 33.5 L648 32.1 L672 30.7 L696 29.3 L720 28.1 L744 26.9 L768 25.9 L792 24.9 L816 24.1 L840 23.4 L864 22.8 L888 22.4 L912 22.1 L936 22.0 L960 22.0 L984 22.2 L1008 22.6 L1032 23.1 L1056 23.7 L1080 24.4 L1104 25.3 L1128 26.3 L1152 27.5 L1176 28.7 L1200 29.9 L1224 31.3 L1248 32.7 L1272 34.1 L1296 35.6 L1320 37.1 L1344 38.5 L1368 39.9 L1392 41.3 L1416 42.7 L1440 43.9 L1464 45.1 L1488 46.1 L1512 47.1 L1536 47.9 L1560 48.6 L1584 49.2 L1608 49.6 L1632 49.9 L1656 50.0 L1680 50.0 L1704 49.8 L1728 49.4 L1752 48.9 L1776 48.3 L1800 47.6 L1824 46.7 L1848 45.7 L1872 44.5 L1896 43.3 L1920 42.1 L1944 40.7 L1968 39.3 L1992 37.9 L2016 36.4 L2040 34.9 L2064 33.5 L2088 32.1 L2112 30.7 L2136 29.3 L2160 28.1 L2184 26.9 L2208 25.9 L2232 24.9 L2256 24.1 L2280 23.4 L2304 22.8 L2328 22.4 L2352 22.1 L2376 22.0 L2400 22.0 L2424 22.2 L2448 22.6 L2472 23.1 L2496 23.7 L2520 24.4 L2544 25.3 L2568 26.3 L2592 27.5 L2616 28.7 L2640 29.9 L2664 31.3 L2688 32.7 L2712 34.1 L2736 35.6 L2760 37.1 L2784 38.5 L2808 39.9 L2832 41.3 L2856 42.7 L2880 43.9 V90 H0Z"/><path class="w-front" d="M0 62.1 L24 61.1 L48 60.1 L72 59.0 L96 57.8 L120 56.6 L144 55.4 L168 54.1 L192 52.8 L216 51.6 L240 50.4 L264 49.2 L288 48.1 L312 47.0 L336 46.0 L360 45.2 L384 44.4 L408 43.7 L432 43.1 L456 42.6 L480 42.3 L504 42.1 L528 42.0 L552 42.1 L576 42.2 L600 42.6 L624 43.0 L648 43.6 L672 44.2 L696 45.0 L720 45.9 L744 46.9 L768 47.9 L792 49.0 L816 50.2 L840 51.4 L864 52.6 L888 53.9 L912 55.2 L936 56.4 L960 57.6 L984 58.8 L1008 59.9 L1032 61.0 L1056 62.0 L1080 62.8 L1104 63.6 L1128 64.3 L1152 64.9 L1176 65.4 L1200 65.7 L1224 65.9 L1248 66.0 L1272 65.9 L1296 65.8 L1320 65.4 L1344 65.0 L1368 64.4 L1392 63.8 L1416 63.0 L1440 62.1 L1464 61.1 L1488 60.1 L1512 59.0 L1536 57.8 L1560 56.6 L1584 55.4 L1608 54.1 L1632 52.8 L1656 51.6 L1680 50.4 L1704 49.2 L1728 48.1 L1752 47.0 L1776 46.0 L1800 45.2 L1824 44.4 L1848 43.7 L1872 43.1 L1896 42.6 L1920 42.3 L1944 42.1 L1968 42.0 L1992 42.1 L2016 42.2 L2040 42.6 L2064 43.0 L2088 43.6 L2112 44.2 L2136 45.0 L2160 45.9 L2184 46.9 L2208 47.9 L2232 49.0 L2256 50.2 L2280 51.4 L2304 52.6 L2328 53.9 L2352 55.2 L2376 56.4 L2400 57.6 L2424 58.8 L2448 59.9 L2472 61.0 L2496 62.0 L2520 62.8 L2544 63.6 L2568 64.3 L2592 64.9 L2616 65.4 L2640 65.7 L2664 65.9 L2688 66.0 L2712 65.9 L2736 65.8 L2760 65.4 L2784 65.0 L2808 64.4 L2832 63.8 L2856 63.0 L2880 62.1 V90 H0Z"/></svg></div>`;

  function chrome() {
    const s = CAT.store;
    const links = [['index.html', 'Home'], ['shop.html', 'Shop'], ['faq.html', 'FAQ'], ['contact.html', 'Contact']];
    const here = location.pathname.split('/').pop() || 'index.html';
    const top = document.createElement('div');
    top.innerHTML = `${s.announcement ? `<div class="announce">${esc(s.announcement)}</div>` : ''}
      <header class="header"><div class="hwrap">
        <div class="h-left"><button class="icon-btn menu-btn" aria-label="Menu">${I.menu}</button>
          <nav class="nav">${links.map(([h, t]) => `<a href="${h}" class="${here === h ? 'active' : ''}">${t}</a>`).join('')}</nav></div>
        <a href="index.html" class="logo">${s.logo ? `<img src="${esc(s.logo)}" alt="${esc(s.name)}">` : esc(s.name)}</a>
        <div class="h-right"><button class="icon-btn search-open" aria-label="Search">${I.search}</button>
          <button class="icon-btn cart-open" aria-label="Open cart">${I.bag}<span class="bubble" data-n="0">0</span></button></div>
      </div>
      <form class="searchbar" action="shop.html" role="search"><input name="q" type="search" placeholder="Search" aria-label="Search"><button class="btn auto">Search</button></form>
      </header>`;
    document.body.prepend(...top.children);
    $('.menu-btn').onclick = () => $('.nav').classList.toggle('open');
    $('.search-open').onclick = () => { $('.searchbar').classList.toggle('open'); $('.searchbar input').focus(); };

    const soc = Object.entries(s.socials || {}).filter(([, u]) => u).map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${n[0].toUpperCase() + n.slice(1)}</a>`).join('');
    const f = document.createElement('footer');
    f.className = 'footer';
    f.innerHTML = `${wave('top')}<div class="fwrap"><div class="grid">
        <div><h3>Quick links</h3><ul>
          <li><a href="shop.html">Search</a></li><li><a href="faq.html">FAQ</a></li><li><a href="contact.html">Contact</a></li>
          <li><a href="policies.html#shipping">Shipping policy</a></li><li><a href="policies.html#returns">Refund policy</a></li>
          <li><a href="policies.html#privacy">Privacy policy</a></li><li><a href="policies.html#terms">Terms of service</a></li></ul>
          ${soc ? `<div class="socials">${soc}</div>` : ''}</div>
        <div><h3>Subscribe to our emails</h3><p>Join our email list for exclusive offers and the latest news.</p>
          <form class="nl" name="newsletter"><label class="sr" for="nl-e">Email</label><input id="nl-e" type="email" name="email" placeholder="Email" required><button class="btn light">Sign up</button></form>
          <p class="nl-msg" hidden>You're on the list! 🎖️</p></div>
      </div>
      <div class="bottom">${payBadges()}<p>© ${new Date().getFullYear()}, ${esc(s.name)}</p></div></div>`;
    document.body.append(f);
    $('.nl', f).addEventListener('submit', (e) => submitForm(e, () => { $('.nl', f).hidden = true; $('.nl-msg', f).hidden = false; }));

    const d = document.createElement('div');
    d.innerHTML = `<div class="overlay"></div><aside class="drawer" aria-label="Cart"><div class="drawer-h"><h2>Your cart</h2><button class="icon-btn cart-close" aria-label="Close cart" style="font-size:1.8rem;line-height:1">×</button></div>
      <div class="lines"></div>
      <div class="drawer-f"><div class="sum"><span>Total</span><span class="tot"></span></div><p class="muted small">Shipping &amp; taxes calculated at checkout.</p>
      <button class="btn checkout">Checkout</button>${payBadges()}</div></aside><div class="toast"></div>
      <button class="to-top" aria-label="Back to top">${I.up}</button>`;
    document.body.append(...d.children);
    $('.overlay').onclick = closeDrawer; $('.cart-close').onclick = closeDrawer; $('.cart-open').onclick = openDrawer; $('.checkout').onclick = checkout;
    document.addEventListener('keydown', (e) => e.key === 'Escape' && closeDrawer());
    const tt = $('.to-top'); tt.onclick = () => scrollTo({ top: 0, behavior: 'smooth' });
    let last = 0; const h = $('.header');
    addEventListener('scroll', () => { const y = scrollY; h.classList.toggle('hide', y > last && y > 200); last = y; tt.classList.toggle('show', y > 600); }, { passive: true });
  }
  const openDrawer = () => { $('.overlay').classList.add('show'); $('.drawer').classList.add('show'); };
  const closeDrawer = () => { $('.overlay')?.classList.remove('show'); $('.drawer')?.classList.remove('show'); };
  function toast(msg) { const t = $('.toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 4500); }

  function renderCart() {
    if (!$('.drawer')) return;
    const lines = cartLines(), n = lines.reduce((s, l) => s + l.qty, 0), total = lines.reduce((s, l) => s + linePrice(l) * l.qty, 0);
    const b = $('.bubble'); b.textContent = n; b.dataset.n = n;
    $('.lines').innerHTML = lines.length ? lines.map((l, i) => {
      const p = product(l.handle), bd = p.bundles, t = bd?.tiers.find((x) => x.id === l.tier);
      const extras = [...(l.addons || []).map((a) => bd?.addons?.find((x) => x.id === a)?.title), ...(l.gifts || []).map((g) => bd?.gifts?.[g]?.title)].filter(Boolean);
      return `<div class="line" data-i="${i}">${img(optVal(p, 'Variant', l.units[0].Variant)?.thumb || unitImage(p, l.units[0]), p.title)}
        <div><b>${esc(p.title)}</b>${t ? `<small class="tier-n">${esc(t.title)}</small>` : ''}
          ${l.units.map((u, j) => `<small>${l.units.length > 1 ? `#${j + 1} ` : ''}${esc(optsLabel(u))}</small>`).join('')}
          ${extras.map((x) => `<small>${esc(x.replace(/^\+\s*/, '+ '))}</small>`).join('')}
          <div class="qty"><button data-d="-1" aria-label="Decrease">−</button><input value="${l.qty}" inputmode="numeric" aria-label="Quantity"><button data-d="1" aria-label="Increase">+</button></div>
          <button class="rm">Remove</button></div><b>${money(linePrice(l) * l.qty)}</b></div>`;
    }).join('') : `<div class="empty"><p>Your cart is empty</p><a class="btn auto" href="index.html">Continue shopping</a></div>`;
    $('.tot').textContent = money(total);
    $('.checkout').disabled = !lines.length;
    $$('.line').forEach((row) => {
      const i = +row.dataset.i;
      const set = (q) => { const c = cartLines(); if (q < 1) c.splice(i, 1); else c[i].qty = Math.min(10, q); writeCart(c); };
      $$('[data-d]', row).forEach((btn) => (btn.onclick = () => set(lines[i].qty + +btn.dataset.d)));
      $('input', row).onchange = (e) => set(parseInt(e.target.value, 10) || 0);
      $('.rm', row).onclick = () => set(0);
    });
  }

  function sessionRef() {
    try {
      let s = localStorage.getItem('tt_session_ref');
      if (!s) { s = (crypto.randomUUID ? crypto.randomUUID() : 'sess_' + Date.now() + Math.random().toString(36).slice(2)); localStorage.setItem('tt_session_ref', s); }
      return s;
    } catch { return 'sess_' + Date.now() + Math.random().toString(36).slice(2); }
  }

  async function checkout() {
    const lines = cartLines();
    if (!lines.length) return;
    const btn = $('.checkout'); if (!btn) return;
    const label = btn.textContent; btn.disabled = true; btn.textContent = 'Loading…';
    const items = lines.map((l) => ({ product_id: l.handle, variant_id: l.tier || null, quantity: l.qty }));
    try {
      const r = await fetch('/api/checkout', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_ref: sessionRef(), items }),
      });
      const d = await r.json().catch(() => null);
      if (d && d.url) { location.assign(d.url); return; }
    } catch {}
    btn.disabled = false; btn.textContent = label;
    toast('Checkout is temporarily unavailable, please try again in a moment.');
  }

  async function submitForm(e, ok) {
    e.preventDefault();
    const f = e.target, data = new URLSearchParams(new FormData(f));
    data.set('form-name', f.getAttribute('name'));
    try { const r = await fetch('/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: data.toString() }); if (!r.ok) throw 0; ok(); }
    catch { toast('Could not send — please try again.'); }
  }

  /* ---------- generic slider (scroll-snap + arrows + dots) ---------- */
  function slider(root) {
    const track = $('.track', root), slides = () => $$('.track > *', root);
    const dotsEl = $('.dots', root);
    const step = () => ((slides()[1]?.offsetLeft ?? 0) - (slides()[0]?.offsetLeft ?? 0)) || track.clientWidth;
    const perView = () => Math.max(1, Math.round((track.clientWidth + 1) / step()));
    const pages = () => Math.max(1, slides().length - perView() + 1);
    const cur = () => Math.round(track.scrollLeft / step());
    const go = (i) => track.scrollTo({ left: Math.max(0, Math.min(pages() - 1, i)) * step(), behavior: 'smooth' });
    const drawDots = () => {
      if (!dotsEl) return; const n = pages();
      dotsEl.innerHTML = n > 1 ? Array.from({ length: n }, (_, i) => `<button aria-label="Go to slide ${i + 1}" class="${i === cur() ? 'on' : ''}"></button>`).join('') : '';
      $$('button', dotsEl).forEach((d, i) => (d.onclick = () => go(i)));
    };
    $('.arr.l', root)?.addEventListener('click', () => go(cur() - 1));
    $('.arr.r', root)?.addEventListener('click', () => go(cur() + 1));
    track.addEventListener('scroll', () => { if (!dotsEl) return; const c = cur(); $$('button', dotsEl).forEach((d, i) => d.classList.toggle('on', i === c)); }, { passive: true });
    addEventListener('resize', drawDots);
    drawDots();
    return { go };
  }

  /* ---------- product page ---------- */
  function renderProduct(el, p) {
    const b = p.bundles;
    const first = Object.fromEntries(p.options.map((o) => [o.name, o.values[0].name]));
    let tierIdx = b ? Math.min(b.default ?? 0, b.tiers.length - 1) : 0;
    let units = [{ ...first }];
    const addons = new Set(), gifts = new Set();
    const tier = () => b?.tiers[tierIdx];
    const sync = () => { const n = tier()?.qty || 1; units = Array.from({ length: n }, (_, i) => units[i] || { ...(units[units.length - 1] || first) }); };
    const pct = p.compare_at_cents > p.price_cents ? Math.floor((1 - p.price_cents / p.compare_at_cents) * 100) : 0;
    const gallery = p.images?.length ? p.images : [PH];

    el.innerHTML = `<div class="product">
      <div class="gallery"><div class="track">${gallery.map((s, i) => `<div class="g-slide">${img(s, p.title, '', i > 0)}</div>`).join('')}</div>
        ${gallery.length > 1 ? `<button class="arr l" aria-label="Previous image">${I.left}</button><button class="arr r" aria-label="Next image">${I.right}</button><div class="dots on-img"></div>` : ''}</div>
      <div class="info">
        ${p.urgency ? `<div class="urgency-wrap"><span class="urgency">${esc(p.urgency)}</span></div>` : ''}
        <h1>${esc(p.title)}</h1>
        ${(() => { const r = 'rating' in p ? p.rating : CAT.store.rating; return r ? `<a class="rating-row" href="#reviews" aria-label="Rated ${r.value} out of 5, ${r.count} reviews"><span class="stars5">${'<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/></svg>'.repeat(5)}</span><span>${esc(String(r.value))}/5 (${Number(r.count).toLocaleString()} Reviews)</span></a>` : ''; })()}
        <div class="price-row"><span class="price">${money(p.price_cents)}</span>${pct ? `<s class="compare">${money(p.compare_at_cents)}</s><span class="badge">${I.tag}SAVE ${pct}%</span>` : ''}</div>
        ${p.highlights?.length ? `<ul class="highlights">${p.highlights.map((h) => `<li><span class="hl-i">${esc(h.icon || '✔️')}</span><span>${esc(h.text)}</span></li>`).join('')}</ul>` : ''}
        ${b ? `<div class="bundles"><div class="bh"><span>${esc(b.headline || 'Bundle & Save')}</span></div><div class="tiers"></div></div>` : '<div class="units-simple"></div>'}
        <button class="btn atc">Add to cart</button>
        ${p.trust?.length ? `<div class="trust">${p.trust.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
        ${payBadges()}
        ${p.reviews?.length ? `<div class="pr-revs"><div class="track">${p.reviews.map((r) => `<div class="pr"><p>"${esc(r.text)}"</p><div class="pr-a">${esc(r.author)} ${stars(r.stars)}</div></div>`).join('')}</div><div class="dots"></div></div>` : ''}
        <div class="tabs">${(p.tabs || []).map((t) => `<details><summary><i class="ck">${I.check}</i><span>${esc(t.heading)}</span><i class="cv">${I.chev}</i></summary><div class="tab-body">${t.html}</div></details>`).join('')}</div>
      </div></div>`;

    const sticky = document.createElement('div');
    sticky.className = 'sticky-atc';
    sticky.innerHTML = `<div class="wrap"><div class="t"><b>${esc(p.title)}</b><span><span class="sp">${money(p.price_cents)}</span>${pct ? ` <s>${money(p.compare_at_cents)}</s>` : ''}</span></div><button class="btn">Add to cart</button></div>`;
    document.body.append(sticky);

    const gal = slider($('.gallery', el));
    const showImage = (src) => { const i = gallery.indexOf(src); if (i >= 0) gal.go(i); };

    const thumbOf = (u) => optVal(p, 'Variant', u.Variant)?.thumb || unitImage(p, u);
    const selectRow = (u, i) => `<div class="unit">${img(thumbOf(u), '', 'u-img')}${p.options.map((o) =>
      `<div class="sel"><select data-u="${i}" data-o="${esc(o.name)}" aria-label="${esc(o.name)} for outfit ${i + 1}">${o.values.map((v) =>
        `<option value="${esc(v.name)}" ${v.name === u[o.name] ? 'selected' : ''} ${isSoldOut(p, { ...u, [o.name]: v.name }) ? 'disabled' : ''}>${esc(v.name)}</option>`).join('')}</select>${I.chev}</div>`).join('')}</div>`;

    const wireSelects = (root) => $$('select[data-u]', root).forEach((s) => (s.onchange = () => {
      units[+s.dataset.u][s.dataset.o] = s.value;
      if (s.dataset.o === 'Variant') showImage(unitImage(p, units[+s.dataset.u]));
      update();
    }));

    const renderTiers = () => {
      const box = $('.tiers', el);
      if (!box) { $('.units-simple', el).innerHTML = `<p class="sl">${p.options.map((o) => o.name).join(', ')}</p>${selectRow(units[0], 0)}`; wireSelects(el); return; }
      box.innerHTML = b.tiers.map((t, ti) => {
        const on = ti === tierIdx;
        const extras = [
          ...(b.addons || []).map((a) => ({ kind: 'addon', id: a.id, title: a.title, image: a.image, price: a.price_cents, compare: 0 })),
          ...(t.gifts || []).map((g) => ({ kind: 'gift', id: g, title: b.gifts[g].title, image: b.gifts[g].image, price: 0, compare: b.gifts[g].compare_at_cents || 0 })),
        ];
        return `<div class="tier ${on ? 'on' : ''}" data-t="${ti}">
          ${t.badge ? `<span class="t-badge ${/most popular/i.test(t.badge) ? 't-badge-pop' : 't-badge-val'}">${esc(t.badge)}</span>` : ''}
          <div class="t-head" role="radio" aria-checked="${on}" tabindex="0"><span class="radio"></span>
            <div class="t-main"><div class="t-top"><b>${esc(t.title)}</b>${t.chip ? `<span class="chip">${esc(t.chip)}</span>` : ''}</div>
              ${t.subtitle ? `<span class="t-sub">${esc(t.subtitle)}</span>` : ''}</div>
            <div class="t-price"><b>${money(t.price_cents)}</b>${t.compare_at_cents > t.price_cents ? `<s>${money(t.compare_at_cents)}</s>` : ''}</div></div>
          ${on && p.options.length ? `<div class="units"><p class="sl">${p.options.map((o) => o.name).join(', ')}</p>${units.map(selectRow).join('')}</div>` : ''}
          ${extras.length ? `<div class="extras">${extras.map((x) => {
            const checked = (x.kind === 'addon' ? addons : gifts).has(x.id);
            return `<label class="extra">${on ? `<input type="checkbox" data-k="${x.kind}" data-id="${esc(x.id)}" ${checked ? 'checked' : ''}><span class="cb"></span>` : ''}
              ${img(x.image, '', 'x-img')}<b>${esc(x.title)}</b><span class="x-price">${money(x.price)}${x.compare ? `<s>${money(x.compare)}</s>` : ''}</span></label>`;
          }).join('')}</div>` : ''}
        </div>`;
      }).join('');
      $$('.tier', box).forEach((t) => {
        const pick = () => { const ti = +t.dataset.t; if (ti === tierIdx) return; tierIdx = ti; sync(); for (const g of [...gifts]) if (!tier().gifts?.includes(g)) gifts.delete(g); update(); };
        t.addEventListener('click', (e) => { if (!e.target.closest('select,.extra')) pick(); });
        $('.t-head', t).addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), pick()));
      });
      $$('.extra input', box).forEach((c) => (c.onchange = () => { const set = c.dataset.k === 'addon' ? addons : gifts; c.checked ? set.add(c.dataset.id) : set.delete(c.dataset.id); }));
      wireSelects(box);
    };

    const update = () => {
      sync(); renderTiers();
      const out = units.some((u) => isSoldOut(p, u));
      [$('.atc', el), $('.btn', sticky)].forEach((x) => { x.disabled = out; x.textContent = out ? 'Sold out' : 'Add to cart'; });
    };
    const add = () => addLine({ handle: p.handle, tier: tier()?.id || null, units: units.map((u) => ({ ...u })), addons: [...addons], gifts: [...gifts] });
    $('.atc', el).onclick = add; $('.btn', sticky).onclick = add;
    new IntersectionObserver(([e]) => sticky.classList.toggle('show', !e.isIntersecting && e.boundingClientRect.top < 0)).observe($('.atc', el));
    const pr = $('.pr-revs', el); if (pr) slider(pr);
    update();
    document.title = `${p.title} – ${CAT.store.name}`;
  }

  /* ---------- other sections ---------- */
  const videoBox = (v, cls) => `<div class="${cls}"><video src="${esc(v.src)}" ${v.poster ? `poster="${esc(v.poster)}"` : ''} muted loop playsinline autoplay preload="metadata"></video>
      ${v.poster ? '' : `<div class="vph"><small>Add ${esc(v.src)}</small></div>`}</div>`;
  function wireVideo(box) {
    const v = $('video', box);
    const missing = () => box.classList.add('missing');
    v.addEventListener('error', missing); if (v.networkState === 3) missing();
    v.addEventListener('loadeddata', () => box.classList.remove('missing'));
  }
  function renderVideos(sec) {
    const vids = (PG ? PG.videos : CAT.store.videos) || []; if (!vids.length) return sec.remove();
    if (PG?.videos_title) $('h2', sec).textContent = PG.videos_title;
    $('.track', sec).innerHTML = vids.map((v) => v && v.src ? videoBox(v, 'slide') : '<div class="slide slide-empty"></div>').join('');
    $$('.slide video').length && $$('.slide', sec).forEach((el) => { if ($('video', el)) wireVideo(el); }); slider(sec);
  }
  function renderFeatured(el) {
    const sec = el.closest('.feat-sec');
    if (PG && sec) {
      if (PG.feature_title) $('h2', sec).textContent = PG.feature_title;
      if (PG.feature_lead) $('.lead', sec).textContent = PG.feature_lead;
      if (!PG.feature_title && !PG.featured_video) return sec.remove();
    }
    const v = PG ? PG.featured_video : CAT.store.featured_video; if (!v?.src) return el.remove();
    el.innerHTML = videoBox(v, 'feat'); wireVideo($('.feat', el));
  }
  function renderReviews(sec) {
    const r = (PG ? PG.reviews : CAT.store.reviews) || []; if (!r.length) return sec.remove();
    const rt = PG ? PG.reviews_title : CAT.store.reviews_title; if (rt) $('h2', sec).textContent = rt;
    sec.classList.toggle('troops-social', !!(PG && PG.reviews_style === 'social'));
    if (PG && PG.reviews_style === 'social') {
      $('.track', sec).innerHTML = r.map((x) => {
        const e = !x || (!x.text && !x.author && !x.image);
        const dots = '<span class="fb-more">•••</span>';
        return `<div class="fbcard${e ? ' fbcard-empty' : ''}"><div class="fb-h"><div class="fb-av">${x && x.avatar ? img(x.avatar, x.author || '') : ''}</div><div class="fb-n"><b>${esc((x && x.author) || '')}</b><small>${esc((x && x.time) || '')}</small></div>${dots}</div><p class="fb-t">${esc((x && x.text) || '')}</p><div class="fb-img">${x && x.image ? img(x.image, x.author || '') : ''}</div></div>`;
      }).join('');
      return slider(sec);
    }
    $('.track', sec).innerHTML = r.map((x) => {
      const empty = !x || (!x.text && !x.title && !x.author && !x.image);
      if (empty) return `<div class="tcard tcard-empty"><div class="t-img t-img-empty"></div><div class="t-body"><div class="stars-empty">${'<svg viewBox="0 0 24 24"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6L2.5 9.4l6.6-.8z"/></svg>'.repeat(5)}</div><h3></h3><p></p><b></b></div></div>`;
      return `<div class="tcard">${x.image ? `<div class="t-img">${img(x.image, x.author)}<span class="q">${I.quote}</span></div>` : ''}<div class="t-body">${stars(x.stars)}${x.title ? `<h3>${esc(x.title)}</h3>` : ''}<p>${esc(x.text)}</p><b><em>${esc(x.author)}</em></b></div></div>`;
    }).join('');
    slider(sec);
  }
  function renderInfographic(sec) {
    const g = PG?.infographic;
    if (!g) return sec.remove();
    $('.ig-title', sec).innerHTML = esc(g.title || '');
    const ph = $('.ig-photo', sec);
    if (g.video) { ph.innerHTML = videoBox({ src: g.video, poster: g.image || '' }, 'ig-vid'); wireVideo($('.ig-vid', ph)); }
    else ph.innerHTML = g.image ? img(g.image, '', 'ig-img', false) : '';
    $('.ig-feats', sec).innerHTML = (g.features || []).map((ft) => `<div class="ig-f"><span class="ig-ic">${ft.icon || ''}</span><b>${esc(ft.title)}</b><small>${esc(ft.text)}</small></div>`).join('');
  }
  function renderCards(sec) {
    const c = PG?.cards;
    if (!c || !c.items?.length) return sec.remove();
    $('.cards-title', sec).textContent = c.title || '';
    $('.cards-lead', sec).textContent = c.lead || '';
    $('.track', sec).innerHTML = c.items.map((it) => `<div class="pcard">${img(it.image, it.title, 'pcard-img')}
      <div class="pcard-b">${it.chip ? `<span class="pcard-chip">${esc(it.chip)}</span>` : ''}<b>${esc(it.title)}</b><p>${esc(it.text)}</p></div></div>`).join('');
    slider(sec);
  }
  function renderFaq(el) {
    el.innerHTML = ((PG && PG.faq) || CAT.faq).map((f) => `<details><summary><i class="ck">${I.check}</i><span>${esc(f.q)}</span><i class="cv">${I.chev}</i></summary><div class="tab-body"><p>${esc(f.a)}</p></div></details>`).join('');
  }
  function renderShop(el) {
    const q = (new URLSearchParams(location.search).get('q') || '').toLowerCase().trim();
    const list = CAT.products.filter((p) => !q || (p.title + ' ' + p.options.flatMap((o) => o.values.map((v) => v.name)).join(' ')).toLowerCase().includes(q));
    if (q) $('h1')?.insertAdjacentHTML('afterend', `<p class="muted">Results for "${esc(q)}"</p>`);
    el.innerHTML = list.length ? list.map((p) => `<a class="card" href="product.html?p=${encodeURIComponent(p.handle)}">${img(p.images?.[0], p.title)}<div class="c"><b>${esc(p.title)}</b>
      <span class="p">${money(p.price_cents)}${p.compare_at_cents ? `<s>${money(p.compare_at_cents)}</s>` : ''}</span></div></a>`).join('') : '<p class="muted">No products found.</p>';
  }

  /* ---------- boot ---------- */
  let PG = null; // per-product overrides for the sections below the product
  function applyTheme() {
    const t = CAT.store.theme; if (!t) return;
    const r = document.documentElement.style;
    if (t.primary) r.setProperty('--olive', t.primary);
    if (t.primary_dark) r.setProperty('--olive-dark', t.primary_dark);
    if (t.accent) r.setProperty('--accent', t.accent);
    if (t.font) r.setProperty('--font', t.font);
  }
  async function boot() {
    try { CAT = await (await fetch('data/catalog.json', { cache: 'no-cache' })).json(); }
    catch { document.body.insertAdjacentHTML('afterbegin', '<p style="padding:20px">Store data failed to load.</p>'); return; }
    applyTheme();
    chrome();
    const pe = $('[data-product]');
    if (pe) { const h = new URLSearchParams(location.search).get('p'); const cur = (h && product(h)) || CAT.products.find((x) => x.featured) || CAT.products[0]; PG = cur.page || null; renderProduct(pe, cur); window.ttPixel?.track('ViewContent', { content_ids: [cur.handle], content_type: 'product', content_name: cur.title, value: cur.price_cents / 100, currency: 'USD' }); }
    $$('[data-designs]').forEach(renderShop);
    $$('[data-infographic]').forEach(renderInfographic);
    $$('[data-cards]').forEach(renderCards);
    $$('[data-featured-video]').forEach(renderFeatured);
    $$('[data-videos]').forEach(renderVideos);
    $$('[data-reviews]').forEach(renderReviews);
    $$('[data-faq]').forEach(renderFaq);
    $$('[data-email]').forEach((e) => { e.textContent = CAT.store.support_email; e.href = 'mailto:' + CAT.store.support_email; });
    const cf = $('form[name="contact"]');
    if (cf) cf.addEventListener('submit', (e) => submitForm(e, () => { cf.reset(); $('.notice').classList.add('show'); }));
    if (document.body.dataset.page === 'thanks') {
      writeCart([]);
      const qp = new URLSearchParams(location.search), on = qp.get('order'), rc = qp.get('receipt');
      if (on) $('.order-no')?.insertAdjacentHTML('beforeend', `Order number: <b>${esc(on)}</b>`);
      if (rc && /^https:\/\/[a-z0-9.-]*squareup(sandbox)?\.com\//i.test(rc)) $('.order-no')?.insertAdjacentHTML('beforeend', ` · <a href="${esc(rc)}" target="_blank" rel="noopener">View receipt</a>`);
    }
    renderCart();
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', boot) : boot();
})();
