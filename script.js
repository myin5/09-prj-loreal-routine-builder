(() => {
  // ---------- DOM ----------
  const els = {
    filter: document.getElementById('categoryFilter'),
    grid: document.getElementById('productsContainer'),
    selected: document.getElementById('selectedProductsList'),
    genBtn: document.getElementById('generateRoutine'),
    chatWin: document.getElementById('chatWindow'),
    chatForm: document.getElementById('chatForm'),
    chatInput: document.getElementById('userInput')
  };

  // Inject search input beside the category filter
  (function ensureSearchInput() {
    const section = document.querySelector('.search-section');
    if (!section || document.getElementById('productSearch')) return;
    const wrap = document.createElement('div');
    wrap.style.marginLeft = '12px';
    wrap.style.flex = '1';
    wrap.innerHTML = `
      <input id="productSearch" type="search" placeholder="Search products…"
             aria-label="Search products"
             style="width:100%;padding:16px;font-size:16px;border:2px solid #000;border-radius:8px;" />
    `;
    section.appendChild(wrap);
  })();

  // Inject RTL toggle in header
  (function ensureRtlToggle() {
    if (document.getElementById('rtlToggle')) return;
    const header = document.querySelector('.site-header');
    if (!header) return;
    const btn = document.createElement('button');
    btn.id = 'rtlToggle';
    btn.textContent = 'RTL';
    btn.style.cssText = 'margin-top:10px;border:2px solid #000;border-radius:8px;padding:6px 10px;background:#fff;cursor:pointer;';
    header.appendChild(btn);
  })();

  const searchInput = document.getElementById('productSearch');
  const rtlToggle = document.getElementById('rtlToggle');

  // ---------- Brand accents via CSS variables (ff003b / e3a535) ----------
  const BRAND_PRIMARY = '#ff003b';
  const BRAND_SECONDARY = '#e3a535';
  if (!document.getElementById('brand-vars')) {
    const style = document.createElement('style');
    style.id = 'brand-vars';
    style.textContent = `
      :root{ --brand-primary:${BRAND_PRIMARY}; --brand-secondary:${BRAND_SECONDARY}; }
      .product-card.selected{ outline: 3px solid var(--brand-primary); outline-offset: 2px; }
      .generate-btn{ background: var(--brand-primary) !important; }
      .generate-btn:hover{ background: #d80033 !important; }
      .bubble.user{ background: rgba(255,0,59,0.12); }
      .routine-block{ border:1px dashed rgba(0,0,0,.15); }
      .badge{ display:inline-block; font-size:11px; padding:3px 8px; border-radius:999px; background:rgba(227,165,53,.14); color:#5b430f; border:1px solid rgba(227,165,53,.45); }
      /* details expander */
      .desc{ display:none; font-size:13px; color:#444; margin-top:8px; line-height:1.45; }
      .desc.open{ display:block; }
      .product-actions{ display:flex; gap:8px; align-items:center; margin-top:8px; }
      .link-btn, .toggle-btn{ font-size:13px; border:1px solid #ccc; background:#fff; padding:6px 8px; border-radius:6px; cursor:pointer; }
      .toggle-btn.active{ border-color: var(--brand-secondary); box-shadow:0 0 0 2px rgba(227,165,53,.25) inset; }
      .selected-toolbar{ display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; }
      .clear-all{ border:1px solid #ccc; background:#fff; padding:6px 10px; border-radius:6px; cursor:pointer; }

      /* RTL adjustments */
      [dir="rtl"] .products-grid { direction: rtl; }
      [dir="rtl"] .chat-form { direction: rtl; }
      [dir="rtl"] .bubble.user { margin-right: auto; margin-left: 0; }
    `;
    document.head.appendChild(style);
  }

  // ---------- State ----------
  const state = {
    products: [],
    selected: new Map(), // id -> product
    user: { skinType: null, concerns: [] },
    chat: [],
    query: ''
  };

  // ---------- Utils ----------
  const $el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else node.setAttribute(k, v);
    }
    children.forEach(c => node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return node;
  };
  const ordinal = n => (['1st','2nd','3rd'][n-1] || `${n}th`);
  const normalizeCategory = (c = '') => String(c).trim().toLowerCase();

  // ---------- Storage ----------
  const LS_KEY = 'selectedProducts.v1';
  function saveSelected() {
    const ids = Array.from(state.selected.keys());
    localStorage.setItem(LS_KEY, JSON.stringify(ids));
  }
  function restoreSelected() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const ids = JSON.parse(raw);
      ids.forEach(id => {
        const p = state.products.find(x => String(x.id) === String(id));
        if (p) state.selected.set(p.id, p);
      });
    } catch {}
  }
  function clearAllSelected() {
    state.selected.clear();
    saveSelected();
    renderSelected();
    renderProducts();
  }

  // ---------- Load & Init ----------
  async function init() {
    await loadProducts();
    restoreSelected();
    renderProducts();
    renderSelected();
    wireEvents();
    pushAssistant("Hi! Pick a few products or tell me your skin goals. When you're ready, tap Generate Routine.");

    // Restore RTL preference
    const dirPref = localStorage.getItem('ui.dir');
    if (dirPref) document.documentElement.setAttribute('dir', dirPref);
  }

  async function loadProducts() {
    try {
      const res = await fetch('products.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load products.json (${res.status})`);
      const data = await res.json();
      state.products = Array.isArray(data) ? data : (data.products || []);
    } catch (e) {
      console.error(e);
      pushAssistant("I couldn't load the product list. Please ensure products.json is available.");
    }
  }

  // ---------- Render ----------
  function filteredProducts() {
    const cat = normalizeCategory(els.filter.value);
    const q = state.query.toLowerCase();
    return state.products.filter(p => {
      const pc = normalizeCategory(p.category);
      const inCat = !cat || pc === cat;
      if (!inCat) return false;
      if (!q) return true;
      const hay = `${p.name} ${p.brand} ${p.category} ${p.description||''}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function renderProducts() {
    els.grid.innerHTML = '';
    const list = filteredProducts();

    list.forEach(p => {
      const isSelected = state.selected.has(p.id);
      const card = $el('article', { class: `product-card${isSelected ? ' selected' : ''}`, dataset: { id: p.id } });

      const img = $el('img', { alt: p.name, src: p.image || '' });
      const info = $el('div', { class: 'product-info' });
      info.append(
        $el('h3', {}, [p.name]),
        $el('p', {}, [p.brand]),
        $el('span', { class: 'badge' }, [p.category])
      );

      const actions = $el('div', { class: 'product-actions' });
      const desc = $el('div', { class: 'desc' }, [p.description || '']);
      const toggleDesc = $el('button', { class: 'toggle-btn', onClick: (e) => {
        e.stopPropagation();
        desc.classList.toggle('open');
        toggleDesc.classList.toggle('active');
        toggleDesc.textContent = desc.classList.contains('open') ? 'Hide details' : 'Details';
      }}, ['Details']);
      const addBtn = $el('button', { class: 'add-btn', onClick: (e) => { e.stopPropagation(); toggleSelect(p); } }, [isSelected ? 'Remove' : 'Add']);
      actions.append(toggleDesc, addBtn);

      card.append(img, info, actions, desc);

      // Click card itself toggles selection (not when clicking buttons)
      card.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        toggleSelect(p);
      });

      els.grid.appendChild(card);
    });
  }

  function toggleSelect(p) {
    if (!p?.id) return;
    if (state.selected.has(p.id)) state.selected.delete(p.id); else state.selected.set(p.id, p);
    saveSelected();
    renderSelected();
    renderProducts();
  }

  function renderSelected() {
    // Toolbar with Clear All
    if (!document.getElementById('selectedToolbar')) {
      const holder = document.querySelector('.selected-products');
      if (holder) {
        const bar = document.createElement('div');
        bar.id = 'selectedToolbar';
        bar.className = 'selected-toolbar';
        bar.innerHTML = `<span class="hint">Click cards or use Add/Remove.</span><button class="clear-all" type="button">Clear all</button>`;
        holder.insertBefore(bar, els.selected);
        bar.querySelector('.clear-all').addEventListener('click', clearAllSelected);
      }
    }

    els.selected.innerHTML = '';
    if (state.selected.size === 0) {
      els.selected.appendChild($el('div', { class: 'empty' }, ['No products selected yet.']));
      return;
    }
    state.selected.forEach(p => {
      const pill = $el('div', { class: 'selected-pill' });
      pill.append(
        $el('img', { class: 'thumb', alt: p.name, src: p.image || '' }),
        $el('span', { class: 'label' }, [`${p.brand}: ${p.name}`]),
        $el('button', { class: 'remove', onClick: () => toggleSelect(p) }, ['×'])
      );
      els.selected.appendChild(pill);
    });
  }

  // ---------- Routine preview (local, before AI) ----------
  function classifyStage(p) {
    const cat = normalizeCategory(p.category);
    const text = `${p.name || ''} ${p.description || ''}`.toLowerCase();
    if (cat.includes('cleanser')) return 'cleanser';
    if (cat.includes('moisturizer')) return 'moisturizer';
    if (cat.includes('suncare') || /\bspf\b|sunscreen/.test(text)) return 'spf';
    if (cat.includes('skincare')) {
      if (/\beye\b/.test(text)) return 'eye';
      return 'treat'; // default treatments
    }
    return null;
  }
  const STAGES = [
    { key: 'cleanser',   label: 'Cleanser',            match: p => classifyStage(p) === 'cleanser' },
    { key: 'treat',      label: 'Treatment/Serum',     match: p => classifyStage(p) === 'treat' },
    { key: 'moisturizer',label: 'Moisturizer',         match: p => classifyStage(p) === 'moisturizer' },
    { key: 'eye',        label: 'Eye',                 match: p => classifyStage(p) === 'eye' },
    { key: 'spf',        label: 'Sunscreen (AM only)', match: p => classifyStage(p) === 'spf' }
  ];
  function buildRoutineFromSelected(selectedList) {
    const eligible = selectedList.filter(p => ['cleanser','moisturizer','suncare','skincare'].includes(normalizeCategory(p.category)) && classifyStage(p));
    const byStage = STAGES.reduce((acc, s) => (acc[s.key] = eligible.filter(s.match), acc), {});
    const am = [], pm = [];
    for (const s of STAGES) {
      (byStage[s.key] || []).forEach(p => {
        const tags = `${p.name} ${p.description || ''}`.toLowerCase();
        if (s.key === 'spf') am.push({ stage: s.label, product: p });
        else if (/exfoliant|retinol|retinal|adapalene|salicylic|\bbha\b|\baha\b|glycolic|lactic|benzoyl/.test(tags)) pm.push({ stage: s.label, product: p });
        else if (/vitamin\s*c/.test(tags)) am.push({ stage: s.label, product: p });
        else if (/\beye\b/.test(tags) && s.key === 'eye') { am.push({ stage: s.label, product: p }); pm.push({ stage: s.label, product: p }); }
        else { am.push({ stage: s.label, product: p }); pm.push({ stage: s.label, product: p }); }
      });
    }
    am.forEach((x,i)=>x.step=i+1); pm.forEach((x,i)=>x.step=i+1);
    return { am, pm };
  }
  function routineNode(r) {
    const wrap = $el('div', { class: 'routine' });
    const list = (title, arr) => $el('div', { class: 'routine-block' }, [
      $el('h3', {}, [title]),
      $el('ol', {}, arr.map(s => $el('li', {}, [ `${s.step}. ${s.stage}: `, $el('strong', {}, [s.product.name]), ` (${s.product.brand})` ])))
    ]);
    wrap.append(list('AM Routine', r.am), list('PM Routine', r.pm));
    return wrap;
  }

  // ---------- Chat helpers ----------
  function pushUser(text) { state.chat.push({ role: 'user', content: text }); appendBubble('user', text); }
  function pushAssistant(text, node) { state.chat.push({ role: 'assistant', content: text }); appendBubble('assistant', text, node); }
  function appendBubble(role, text, htmlNode) {
    const bubble = $el('div', { class: `bubble ${role}` });
    if (htmlNode) bubble.appendChild(htmlNode); else bubble.appendChild($el('p', {}, [text]));
    els.chatWin.appendChild(bubble); els.chatWin.scrollTop = els.chatWin.scrollHeight;
  }

  
  
  const WORKER_URL = 'https://project8-chatbot.myin5.workers.dev/';
  async function callAI(messages, selectedProducts) {
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages,
          selected: selectedProducts,
          allowWeb: true  // let the Worker do real-time web search + citations
        })
      });
      if (!res.ok) throw new Error(`AI error ${res.status}`);
      const data = await res.json();
      return data.reply?.trim() || null;
    } catch (e) {
      console.info('[AI] Error:', e.message);
      return null;
    }
  }

  // ---------- Events ----------
  function wireEvents() {
    els.filter.addEventListener('change', renderProducts);
    if (searchInput) searchInput.addEventListener('input', (e) => {
      state.query = e.target.value || '';
      renderProducts();
    });

    els.genBtn.addEventListener('click', async () => {
      const selected = Array.from(state.selected.values());
      if (!selected.length) { pushAssistant('Select a few products first (cleanser, serum, moisturizer, SPF, etc.).'); return; }

      // Local preview routine (immediate)
      const preview = buildRoutineFromSelected(selected);
      pushAssistant('Here’s a quick preview based on your picks:', routineNode(preview));

      // AI-generated routine 
      const payload = selected.map(({id, name, brand, category, description, image}) => ({id, name, brand, category, description, image}));
      const aiReply = await callAI(state.chat, payload);
      if (aiReply) pushAssistant(aiReply); else pushAssistant('I couldn’t reach the AI service. The preview routine above should still help!');
    });

    els.chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = els.chatInput.value.trim();
      if (!msg) return;
      els.chatInput.value = '';
      pushUser(msg);

      // Light profile extraction for better previews
      const stMatch = msg.match(/\b(dry|oily|combination|combo|normal|sensitive)\b/i);
      if (stMatch) state.user.skinType = stMatch[1].toLowerCase() === 'combination' ? 'combo' : stMatch[1].toLowerCase();
      const possible = ['acne','breakout','pigmentation','dark spot','wrinkle','redness','sensitivity','barrier','pores','dull'];
      state.user.concerns = possible.filter(c => new RegExp(c, 'i').test(msg)).map(c => c.replace(' ', ''));

      const selected = Array.from(state.selected.values());
      const payload = selected.map(({id, name, brand, category, description}) => ({id, name, brand, category, description}));
      const aiReply = await callAI(state.chat, payload);
      pushAssistant(aiReply || 'Happy to help! Ask me about skincare, haircare, makeup, or fragrance.');
    });

    // RTL toggle
    if (rtlToggle) rtlToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('dir') || 'ltr';
      const next = current === 'rtl' ? 'ltr' : 'rtl';
      document.documentElement.setAttribute('dir', next);
      localStorage.setItem('ui.dir', next);
    });
  }

  // ---------- Kickoff ----------
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();