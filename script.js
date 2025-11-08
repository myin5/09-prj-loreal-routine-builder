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

  // Inject search input beside the category filter (idempotent; no CSS injected)
  (function ensureSearchInput() {
    const section = document.querySelector('.search-section');
    if (!section || document.getElementById('productSearch')) return;
    const wrap = document.createElement('div');
    wrap.className = 'search-wrap';
    wrap.innerHTML = `
      <input id="productSearch" type="search" placeholder="Search products…" aria-label="Search products" />
    `;
    section.appendChild(wrap);
  })();

  // Inject RTL toggle button (no CSS injected; your stylesheet handles [dir="rtl"])
  (function ensureRtlToggle() {
    if (document.getElementById('rtlToggle')) return;
    const header = document.querySelector('.site-header');
    if (!header) return;
    const btn = document.createElement('button');
    btn.id = 'rtlToggle';
    btn.type = 'button';
    btn.textContent = 'RTL';
    header.appendChild(btn);
  })();

  const searchInput = document.getElementById('productSearch');
  const rtlToggle = document.getElementById('rtlToggle');

  // ---------- State ----------
  const state = {
    products: [],
    productById: new Map(),
    selected: new Map(),
    chat: [],
    query: localStorage.getItem('ui.search') || '',
    filter: localStorage.getItem('ui.filter') || '',
    user: { skinType: null, concerns: [] }
  };

  // ---------- Utils ----------
  const $el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v, { passive: true });
      else node.setAttribute(k, v);
    }
    for (const c of children) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    return node;
  };
  const normalize = (s='') => String(s).trim().toLowerCase();
  const safeSrc = (u)=> /^https?:\/\//i.test(u||'') ? u : (u ? u : 'about:blank');
  const debounce = (fn, ms=120)=>{ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };

  // ---------- Storage ----------
  const LS_KEY = 'selectedProducts.v1';
  function saveSelected() { localStorage.setItem(LS_KEY, JSON.stringify([...state.selected.keys()])); }
  function restoreSelected() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      for (const id of JSON.parse(raw)) {
        const p = state.productById.get(String(id));
        if (p) state.selected.set(p.id, p);
      }
    } catch {}
  }

  // ---------- Stage classification ----------
  function classifyStageFromText(cat,text) {
    if (/(cleanser|wash|gel cleanser|cleansing balm|micellar)/.test(cat+text)) return 'cleanser';
    if (/(moisturizer|cream|lotion|gel-cream|emulsion)/.test(cat+text)) return 'moisturizer';
    if (/(suncare|sunscreen|spf)/.test(cat+text)) return 'spf';
    if (/\beye\b/.test(cat+text)) return 'eye';
    if (/(serum|treatment|booster|essence|ampoule|toner|exfoliant|mask)/.test(cat+text)) return 'treat';
    return null;
  }
  const STAGES = [
    { key: 'cleanser',   label: 'Cleanser' },
    { key: 'treat',      label: 'Treatment/Serum' },
    { key: 'moisturizer',label: 'Moisturizer' },
    { key: 'eye',        label: 'Eye' },
    { key: 'spf',        label: 'Sunscreen (AM only)' }
  ];

  // ---------- Init ----------
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();

  async function init() {
    if (searchInput) searchInput.value = state.query;
    if (els.filter && state.filter) els.filter.value = state.filter;

    await loadProducts();
    indexProducts();       // precompute normalized fields once (O(N))
    buildGridOnce();       // build DOM once (O(N))
    restoreSelected();     // restore selections from LS
    ensureSelectedToolbar();
    renderSelected();      // render pills (O(S))
    applyFilterAndSearch();// show/hide only (O(N))

    wireEvents();

    // Chat a11y
    els.chatWin?.setAttribute('role','log');
    els.chatWin?.setAttribute('aria-live','polite');

    // Restore dir pref
    const dirPref = localStorage.getItem('ui.dir');
    if (dirPref) document.documentElement.setAttribute('dir', dirPref);

    pushAssistant("Hi! Pick a few products or tell me your skin goals. When you're ready, tap Generate Routine.");
  }

  async function loadProducts() {
    try {
      const res = await fetch('products.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load products.json (${res.status})`);
      const data = await res.json();
      state.products = Array.isArray(data) ? data : (data.products || []);
    } catch (e) {
      console.error(e);
      state.products = [];
      pushAssistant("I couldn't load the product list. Please ensure products.json is available.");
    }
  }

  // Precompute normalized/cached fields
  function indexProducts() {
    state.productById.clear();
    for (const p of state.products) {
      const nameL = normalize(p.name);
      const brandL = normalize(p.brand);
      const catL = normalize(p.category);
      const descL = normalize(p.description||'');
      const haystack = `${nameL} ${brandL} ${catL} ${descL}`;
      const stage = classifyStageFromText(catL, ` ${nameL} ${descL}`);
      p.__norm = { nameL, brandL, catL, descL, haystack, stage };
      state.productById.set(String(p.id), p);
    }
  }

  // ---------- Grid: build once, then patch/show/hide ----------
  function buildGridOnce() {
    if (!els.grid) return;
    els.grid.innerHTML = '';
    const frag = document.createDocumentFragment();

    for (const p of state.products) {
      const card = $el('article', {
        class: 'product-card',
        dataset: { id: p.id, cat: p.__norm.catL },
        tabindex: '0'
      });

      const img = $el('img', { alt: p.name, src: safeSrc(p.image), loading: 'lazy' });
      const info = $el('div', { class: 'product-info' }, [
        $el('h3', {}, [p.name]),
        $el('p', {}, [p.brand]),
        $el('span', { class: 'badge' }, [p.category])
      ]);

      // Details (ARIA)
      const descId = `desc-${p.id}`;
      const desc = $el('div', { id: descId, class: 'desc', role:'region' }, [p.description || '']);
      const toggleDesc = $el('button', {
        class: 'toggle-btn',
        'aria-expanded': 'false',
        'aria-controls': descId
      }, ['Details']);

      const addBtn = $el('button', { class: 'add-btn' }, ['Add']);
      const actions = $el('div', { class: 'product-actions' }, [toggleDesc, addBtn]);

      card.append(img, info, actions, desc);
      frag.appendChild(card);
    }
    els.grid.appendChild(frag);
  }

  // Show/hide by filter/search without rebuilding nodes
  function applyFilterAndSearch() {
    if (!els.grid) return;
    const q = normalize(state.query);
    const cat = normalize(state.filter);
    const all = els.grid.children;

    for (let i = 0; i < all.length; i++) {
      const card = all[i];
      const id = card.dataset.id;
      const p = state.productById.get(String(id));
      const inCat = !cat || cat === 'all' || p.__norm.catL === cat || p.__norm.catL.includes(cat);
      const inSearch = !q || p.__norm.haystack.includes(q);
      card.style.display = (inCat && inSearch) ? '' : 'none';

      // keep selected visuals synced cheaply
      const selected = state.selected.has(p.id);
      if (selected !== card.classList.contains('selected')) {
        card.classList.toggle('selected', selected);
        const btn = card.querySelector('.add-btn');
        if (btn) btn.textContent = selected ? 'Remove' : 'Add';
      }
    }
  }

  // Toggle selection; patch only affected card + pills
  function toggleSelect(p) {
    if (!p?.id) return;
    if (state.selected.has(p.id)) state.selected.delete(p.id); else state.selected.set(p.id, p);
    saveSelected();
    renderSelected();

    const card = els.grid?.querySelector(`.product-card[data-id="${p.id}"]`);
    if (card) {
      const isSel = state.selected.has(p.id);
      card.classList.toggle('selected', isSel);
      const btn = card.querySelector('.add-btn');
      if (btn) btn.textContent = isSel ? 'Remove' : 'Add';
    }
  }

  // ---------- Selected products UI ----------
  function ensureSelectedToolbar() {
    if (document.getElementById('selectedToolbar')) return;
    const holder = document.querySelector('.selected-products');
    if (!holder || !els.selected) return;
    const bar = document.createElement('div');
    bar.id = 'selectedToolbar';
    bar.className = 'selected-toolbar';
    bar.innerHTML = `<span class="hint">Click cards or use Add/Remove.</span><button class="clear-all" type="button">Clear all</button>`;
    holder.insertBefore(bar, els.selected);
    bar.querySelector('.clear-all').addEventListener('click', () => {
      state.selected.clear();
      saveSelected();
      renderSelected();
      applyFilterAndSearch();
    }, { passive: true });
  }

  function renderSelected() {
    if (!els.selected) return;
    els.selected.innerHTML = '';
    if (state.selected.size === 0) {
      els.selected.appendChild($el('div', { class: 'placeholder-message' }, ['No products selected yet.']));
      return;
    }
    const frag = document.createDocumentFragment();
    state.selected.forEach(p => {
      const pill = $el('div', { class: 'selected-pill' }, [
        $el('img', { class: 'thumb', alt: p.name, src: safeSrc(p.image), loading:'lazy' }),
        $el('span', { class: 'label' }, [`${p.brand}: ${p.name}`]),
        $el('button', { class: 'remove', onClick: () => toggleSelect(p) }, ['×'])
      ]);
      frag.appendChild(pill);
    });
    els.selected.appendChild(frag);
  }

  // ---------- Routine preview (local) ----------
  function buildRoutineFromSelected(selectedList) {
    const elig = selectedList.filter(p => p.__norm.stage && ['cleanser','moisturizer','spf','treat','eye'].includes(p.__norm.stage));
    const byStage = { cleanser:[], treat:[], moisturizer:[], eye:[], spf:[] };
    for (const p of elig) byStage[p.__norm.stage].push(p);

    const am=[], pm=[];
    const pushAm = (stage, p)=>am.push({ stage, product:p });
    const pushPm = (stage, p)=>pm.push({ stage, product:p });

    for (const s of STAGES) {
      const list = byStage[s.key];
      if (!list || !list.length) continue;
      const p = list[0]; // cap to one per stage by default
      const tags = `${p.__norm.nameL} ${p.__norm.descL}`;
      if (s.key === 'spf') pushAm(s.label, p);
      else if (/(exfoliant|retinol|retinal|adapalene|salicylic|\bbha\b|\baha\b|glycolic|lactic|benzoyl)/.test(tags)) pushPm(s.label, p);
      else if (/vitamin\s*c/.test(tags)) pushAm(s.label, p);
      else if (s.key === 'eye') { pushAm(s.label, p); pushPm(s.label, p); }
      else { pushAm(s.label, p); pushPm(s.label, p); }
    }
    am.forEach((x,i)=>x.step=i+1); pm.forEach((x,i)=>x.step=i+1);
    return { am, pm };
  }

  function routineNode(r) {
    const wrap = $el('div', { class: 'routine' });
    const list = (title, arr) => $el('div', { class: 'routine-block' }, [
      $el('h3', {}, [title]),
      $el('ol', {}, arr.map(s => $el('li', {}, [
        `${s.step}. ${s.stage}: `,
        $el('strong', {}, [s.product.name]),
        ` (${s.product.brand})`
      ])))
    ]);
    wrap.append(list('AM Routine', r.am), list('PM Routine', r.pm));
    return wrap;
  }

  // ---------- Chat helpers ----------
  function pushUser(text) { state.chat.push({ role: 'user', content: text }); appendBubble('user', text); }
  function pushAssistant(text, node) { state.chat.push({ role: 'assistant', content: text }); appendBubble('assistant', text, node); }
  function appendBubble(role, text, htmlNode) {
    if (!els.chatWin) return;
    const bubble = $el('div', { class: `bubble ${role}` });
    if (htmlNode) bubble.appendChild(htmlNode); else bubble.appendChild($el('p', {}, [text]));
    els.chatWin.appendChild(bubble);
    els.chatWin.scrollTop = els.chatWin.scrollHeight;
  }

  // ---------- AI (Worker) ----------
  const WORKER_URL = 'https://project8-chatbot.myin5.workers.dev/';

  async function callAI(messages) {
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), 20000);
    try {
      const res = await fetch(WORKER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages }),
        signal: ctrl.signal
      });
      const text = await res.text();
      if (!res.ok) return `⚠️ Worker error ${res.status}: ${text}`;
      let data; try { data = JSON.parse(text); } catch { return '⚠️ Worker returned invalid JSON.'; }
      if (data?.error) return `⚠️ OpenAI error: ${data.error.message || data.error}`;
      const content = data?.choices?.[0]?.message?.content;
      return content ? String(content).trim() : '⚠️ No content in OpenAI response.';
    } catch (e) {
      return `⚠️ ${e.name === 'AbortError' ? 'AI request timed out' : (e.message || 'AI request failed')}`;
    } finally { clearTimeout(t); }
  }

  // Guardrail + context (ask model to include visible citations for real-world facts)
  const SYSTEM_PROMPT =
    "You are a L’Oréal-focused advisor. Stay on topics: skincare, haircare, makeup, fragrance. " +
    "Use only the provided selected product JSON and user questions to create AM/PM routines and give follow-ups. " +
    "When stating real-world facts, include a short citation with a visible URL. If you can’t verify, say so. " +
    "Be practical, concise, and safe. If something is outside scope, briefly say so.";

  function buildMessagesForRoutine(selectedProducts, chatHistory) {
    const context = {
      selectedProducts: selectedProducts.map(p => ({
        id: p.id, brand: p.brand, name: p.name, category: p.category, description: p.description
      }))
    };
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'system', content: JSON.stringify(context) },
      ...chatHistory,
      { role: 'user', content: "Generate a clear AM/PM routine using only the selected products. Then ask one short follow-up question." }
    ];
  }
  function buildMessagesForFollowUp(selectedProducts, chatHistory, userMsg) {
    const context = {
      selectedProducts: selectedProducts.map(p => ({
        id: p.id, brand: p.brand, name: p.name, category: p.category, description: p.description
      }))
    };
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'system', content: JSON.stringify(context) },
      ...chatHistory,
      { role: 'user', content: userMsg }
    ];
  }

  // ---------- Events ----------
  function wireEvents() {
    if (els.filter) els.filter.addEventListener('change', () => {
      state.filter = els.filter.value || '';
      localStorage.setItem('ui.filter', state.filter);
      requestAnimationFrame(applyFilterAndSearch);
    }, { passive: true });

    if (searchInput) {
      const onInput = debounce((e) => {
        state.query = e.target.value || '';
        localStorage.setItem('ui.search', state.query);
        applyFilterAndSearch();
      }, 120);
      searchInput.addEventListener('input', onInput);
    }

    // Event delegation for grid clicks + keyboard
    if (els.grid) {
      els.grid.addEventListener('click', (e) => {
        const card = e.target.closest('.product-card');
        if (!card) return;
        const id = card.dataset.id;
        const p = state.productById.get(String(id));
        if (!p) return;

        if (e.target.classList.contains('toggle-btn')) {
          const desc = card.querySelector('.desc');
          const open = !desc.classList.contains('open');
          desc.classList.toggle('open', open);
          e.target.classList.toggle('active', open);
          e.target.textContent = open ? 'Hide details' : 'Details';
          e.target.setAttribute('aria-expanded', String(open));
          return;
        }
        if (e.target.classList.contains('add-btn') || e.target === card || e.target.closest('.product-info')) {
          toggleSelect(p);
        }
      });

      els.grid.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const card = e.target.closest('.product-card');
        if (!card) return;
        e.preventDefault();
        const p = state.productById.get(String(card.dataset.id));
        if (p) toggleSelect(p);
      });
    }

    if (els.genBtn) els.genBtn.addEventListener('click', onGenerate);
    if (els.chatForm) els.chatForm.addEventListener('submit', onChatSubmit);

    if (rtlToggle) rtlToggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('dir') || 'ltr';
      const next = current === 'rtl' ? 'ltr' : 'rtl';
      document.documentElement.setAttribute('dir', next);
      localStorage.setItem('ui.dir', next);
    });
  }

  async function onGenerate() {
    const selected = [...state.selected.values()];
    if (!selected.length) {
      pushAssistant('Select a few products first (cleanser, serum, moisturizer, SPF, etc.).');
      return;
    }

    if (els.genBtn) { els.genBtn.disabled = true; var oldTxt = els.genBtn.textContent; els.genBtn.textContent = 'Generating…'; }

    // Local preview (cheap)
    document.querySelector('#routine-preview')?.remove();
    const preview = buildRoutineFromSelected(selected);
    const node = routineNode(preview); node.id = 'routine-preview';
    pushAssistant('Here’s a quick preview based on your picks:', node);

    try {
      const messages = buildMessagesForRoutine(selected, state.chat);
      const aiReply = await callAI(messages);
      pushAssistant(aiReply);
    } finally {
      if (els.genBtn) { els.genBtn.disabled = false; els.genBtn.textContent = oldTxt || 'Generate'; }
    }
  }

  async function onChatSubmit(e) {
    e.preventDefault();
    const msg = els.chatInput.value.trim();
    if (!msg) return;
    els.chatInput.value = '';
    pushUser(msg);
    els.chatInput.focus();

    // lightweight profile extraction
    const stMatch = msg.match(/\b(dry|oily|combination|combo|normal|sensitive)\b/i);
    if (stMatch) state.user.skinType = stMatch[1].toLowerCase() === 'combination' ? 'combo' : stMatch[1].toLowerCase();
    const possible = ['acne','breakout','pigmentation','dark spot','wrinkle','redness','sensitivity','barrier','pores','dull'];
    state.user.concerns = possible.filter(c => new RegExp(c, 'i').test(msg)).map(c => c.replace(' ', ''));

    const selected = [...state.selected.values()];
    const messages = buildMessagesForFollowUp(selected, state.chat, msg);
    const aiReply = await callAI(messages);
    pushAssistant(aiReply);
  }
})();