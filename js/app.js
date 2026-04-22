// app.js - entry, state, router, sidebar, global handlers.
// Shared helpers used by views/exports/bpmn: escapeHtml, escapeAttr,
// resolvePerson, totalProcesses, processesWithBpmn, findGroupInCollection,
// addRecent, renderBreadcrumb, processHrefFor, collectionHrefFor.

// Process Hub Reader — main app
// Loads all collections at boot. Renders Home (KPIs + table), Collection
// landing (diagram/table toggle), and Process view (BPMN).

// ─── State ──────────────────────────────────────────────────────────
const state = {
  collections: [],        // [{ ...index, landscape: { id, areas: [...] } }]
  people: {},             // { personId: { id, name, org, email } }
  route: { name: 'home' },
  filters: {},            // filters[collId] = { phases: Set, status: 'all'|'active'|'inactive' }
  filterPanelOpen: false,
  grouping: {},           // grouping[collId] = 'area' | 'owner' | 'status' | 'none'
  groupingMenuOpen: false,
  exportMenuOpen: false,  // shared between collection and process export dropdowns
  expandedCollections: new Set(),  // sidebar tree: which collections are expanded
  skippedCollections: [],  // populated in init() when a collection fails to load/validate
  recents: [],
  bpmnViewer: null,
};

const GROUPING_OPTIONS = [
  { id: 'area',   label: 'Bereich' },
  { id: 'owner',  label: 'Owner' },
  { id: 'status', label: 'Status' },
  { id: 'none',   label: 'Ohne Gruppierung' }
];

const STATUS_LABELS = {
  approved:   { label: 'Freigegeben',   badge: 'badge-certified' },
  'in-review':{ label: 'In Prüfung',    badge: 'badge-review' },
  draft:      { label: 'Entwurf',       badge: 'badge-draft' },
  deprecated: { label: 'Veraltet',      badge: 'badge-deprecated' }
};

const RECENTS_KEY      = 'processHub.recents';
const SIDEBAR_KEY      = 'processHub.sidebarCollapsed';
const SIDEBAR_WIDTH_KEY = 'processHub.sidebarWidth';
const EXPANDED_KEY     = 'processHub.expandedCollections';
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 480;

// ─── Bootstrapping ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  restoreLocalState();
  try {
    const [indexRes, peopleRes] = await Promise.all([
      fetch('data/collections.json'),
      fetch('data/people.json')
    ]);
    if (!indexRes.ok) throw new Error(`collections.json: ${indexRes.status}`);
    if (!peopleRes.ok) throw new Error(`people.json: ${peopleRes.status}`);
    const index = await indexRes.json();
    const people = await peopleRes.json();
    state.people = Object.fromEntries((people.people || []).map(p => [p.id, p]));

    // Load every collection independently. One bad file shouldn't take
    // the whole app down — we keep the successful ones and log the rest.
    const results = await Promise.allSettled(
      index.collections.map(c => fetch(c.file).then(r => {
        if (!r.ok) throw new Error(`${c.file}: HTTP ${r.status}`);
        return r.json();
      }))
    );
    state.collections = [];
    state.skippedCollections = [];
    results.forEach((res, i) => {
      const meta = index.collections[i];
      if (res.status === 'fulfilled' && validateCollection(res.value, meta.id)) {
        state.collections.push({ ...meta, landscape: res.value });
      } else {
        const reason = res.status === 'rejected' ? res.reason?.message : 'Schema ungültig';
        console.warn(`Collection "${meta.id}" skipped: ${reason}`);
        state.skippedCollections.push({ id: meta.id, name: meta.name, reason });
      }
    });
    if (state.collections.length === 0) {
      throw new Error('Keine Sammlung konnte geladen werden.');
    }
    state.collections.forEach(c => {
      state.filters[c.id] = {
        phases:   new Set(),   // Bereich IDs
        owners:   new Set(),   // person IDs (from people.json)
        statuses: new Set()    // lifecycle: approved | in-review | draft | deprecated
      };
      state.grouping[c.id] = 'area';
    });
  } catch (err) {
    showFatalError(err);
    return;
  }

  wireGlobalHandlers();
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('app').style.display = '';
  handleRoute();
}

function restoreLocalState() {
  try {
    const r = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
    if (Array.isArray(r)) {
      // Defensive: discard any entries that don't match { title, hash } shape.
      // Corrupted or schema-drifted storage would otherwise render 'null'
      // in the sidebar's "Zuletzt angesehen" list.
      state.recents = r
        .filter(x => x && typeof x.title === 'string' && typeof x.hash === 'string' && x.hash.startsWith('#/'))
        .slice(0, 8);
    }
  } catch { /* ignore */ }
  try {
    const arr = JSON.parse(localStorage.getItem(EXPANDED_KEY) || '[]');
    if (Array.isArray(arr)) state.expandedCollections = new Set(arr);
  } catch { /* ignore */ }
  if (localStorage.getItem(SIDEBAR_KEY) === '1') {
    document.body.classList.add('sidebar-collapsed');
  }
  const savedWidth = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) || '', 10);
  if (savedWidth >= SIDEBAR_MIN_WIDTH && savedWidth <= SIDEBAR_MAX_WIDTH) {
    document.body.style.setProperty('--sidebar-width', savedWidth + 'px');
  }
}

function persistRecents() {
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(state.recents)); } catch { /* ignore */ }
}

function persistExpanded() {
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...state.expandedCollections])); }
  catch { /* ignore */ }
}

// ─── Tab-preserving href helpers ────────────────────────────────────
// When navigating between same-entity-type items (process → process, or
// collection → collection), keep the user on the tab they're currently
// viewing so a click in the tree doesn't snap them back to Diagramm / Tabelle.
function processHrefFor(collId, processId) {
  const base = `#/c/${encodeURIComponent(collId)}/process/${encodeURIComponent(processId)}`;
  const tab = state.route.name === 'process' ? state.route.detailTab : '';
  return (tab && tab !== 'diagram') ? `${base}/${tab}` : base;
}
function collectionHrefFor(collId) {
  const base = `#/c/${encodeURIComponent(collId)}`;
  const v = state.route.name === 'collection' ? state.route.view : '';
  const withView = (v && v !== 'table') ? `${base}/${v}` : base;
  // Preserve filters/grouping across Tabelle/Diagramm/Metadaten navigation
  // within the same collection, so users can share a filtered URL.
  const sameColl = state.route.name === 'collection' && state.route.collId === collId;
  return withView + (sameColl ? encodeCollectionQuery(collId) : '');
}

// Build a `?phases=a,b&owners=...&statuses=...&grouping=...` tail for the
// hash URL. Empty sets / default grouping render no parameter so the
// simple case stays a short URL.
function encodeCollectionQuery(collId) {
  const f = state.filters[collId];
  if (!f) return '';
  const grouping = state.grouping[collId] || 'area';
  const parts = [];
  const push = (key, set) => {
    if (set.size) parts.push(`${key}=${[...set].map(encodeURIComponent).join(',')}`);
  };
  push('phases',   f.phases);
  push('owners',   f.owners);
  push('statuses', f.statuses);
  if (grouping !== 'area') parts.push(`grouping=${encodeURIComponent(grouping)}`);
  return parts.length ? '?' + parts.join('&') : '';
}

// Inverse: take the `?phases=…` query from the route and replace the
// collection's filter state with whatever the URL says. Called from
// handleRoute when navigating onto a collection view.
function applyCollectionRouteToState(route) {
  if (route.name !== 'collection') return;
  const f = state.filters[route.collId];
  if (!f) return;
  const q = route.query || {};
  const toSet = (v) => new Set((v || '').split(',').filter(Boolean));
  f.phases   = toSet(q.phases);
  f.owners   = toSet(q.owners);
  f.statuses = toSet(q.statuses);
  state.grouping[route.collId] =
    /^(area|owner|status|none)$/.test(q.grouping || '') ? q.grouping : 'area';
}

// Push the current filter/grouping state into the URL (without a new
// history entry — chip clicks shouldn't clutter back-button).
function syncCollectionUrl() {
  if (state.route.name !== 'collection') return;
  const base = `#/c/${encodeURIComponent(state.route.collId)}${state.route.view && state.route.view !== 'table' ? '/' + state.route.view : ''}`;
  const qs = encodeCollectionQuery(state.route.collId);
  const target = base + qs;
  if (target !== window.location.hash) {
    history.replaceState(null, '', target);
    state.route = parseRoute();
  }
}

// Minimal structural check. Catches typos and truncated JSON; doesn't
// try to be zod. Returns true if the collection looks usable, false
// otherwise (and logs what's wrong so dev sees the first bad field).
function validateCollection(data, expectedId) {
  const bad = (msg) => { console.warn(`[collection ${expectedId}] ${msg}`); return false; };
  if (!data || typeof data !== 'object') return bad('not an object');
  if (!Array.isArray(data.areas))        return bad('areas[] missing');
  for (const a of data.areas) {
    if (!a || typeof a !== 'object')     return bad('area is not an object');
    if (typeof a.id !== 'string')        return bad('area.id missing/not a string');
    if (typeof a.name !== 'string')      return bad(`area ${a.id}: name missing`);
    if (!Array.isArray(a.groups))        return bad(`area ${a.id}: groups[] missing`);
    for (const g of a.groups) {
      if (!g || typeof g !== 'object')   return bad(`area ${a.id}: group is not an object`);
      if (typeof g.id !== 'string')      return bad(`area ${a.id}: group.id missing`);
      if (typeof g.name !== 'string')    return bad(`group ${g.id}: name missing`);
    }
  }
  return true;
}

function showFatalError(err) {
  document.getElementById('loading-screen').innerHTML = `
    <div style="max-width: 480px; text-align: center; padding: 32px;">
      <h2 style="margin-bottom: 12px; color: var(--color-text-primary);">Daten konnten nicht geladen werden</h2>
      <p style="color: var(--color-text-secondary); margin-bottom: 8px;">${escapeHtml(err.message)}</p>
      <p class="text-sub">
        Die Seite muss über einen HTTP-Server geöffnet werden
        (z.&nbsp;B. <code>python -m http.server</code>).
        <code>file://</code> blockiert <code>fetch</code>.
      </p>
    </div>`;
}

// ─── Router ─────────────────────────────────────────────────────────
function navigate(hash) {
  if (window.location.hash === hash) handleRoute();
  else window.location.hash = hash;
}

function parseRoute() {
  const hash = window.location.hash || '#/';
  // Strip query string before splitting the path so "#/search?q=..." works.
  const qSplit = hash.indexOf('?');
  const pathPart = qSplit >= 0 ? hash.slice(0, qSplit) : hash;
  const queryStr = qSplit >= 0 ? hash.slice(qSplit + 1) : '';
  const parts = pathPart.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'search') {
    const qMatch = queryStr.match(/(?:^|&)q=([^&]*)/);
    return { name: 'search', q: qMatch ? decodeURIComponent(qMatch[1].replace(/\+/g, ' ')) : '' };
  }
  if (parts[0] === 'chat') return { name: 'chat' };
  if (parts[0] === 'workflows') return { name: 'workflows' };
  if (parts[0] === 'recents') return { name: 'recents' };
  if (parts[0] === 'c' && parts[1]) {
    const collId = decodeURIComponent(parts[1]);
    if (parts[2] === 'process' && parts[3]) {
      const rawTab = parts[4];
      const detailTab = (rawTab === 'metadata' || rawTab === 'steps') ? rawTab : 'diagram';
      return { name: 'process', collId, processId: decodeURIComponent(parts[3]), detailTab };
    }
    const view = parts[2] === 'diagram' ? 'diagram'
               : parts[2] === 'metadata' ? 'metadata'
               : 'table';
    // Parse the filter/grouping query string so it survives reload + share.
    const query = {};
    for (const kv of queryStr.split('&').filter(Boolean)) {
      const eq = kv.indexOf('=');
      const k = eq >= 0 ? kv.slice(0, eq) : kv;
      const v = eq >= 0 ? decodeURIComponent(kv.slice(eq + 1)) : '';
      query[k] = v;
    }
    return { name: 'collection', collId, view, query };
  }
  return { name: 'home' };
}

function handleRoute() {
  state.route = parseRoute();
  state.filterPanelOpen = false;
  hideSearchDropdown();
  syncHeaderSearch(state.route.name === 'search' ? (state.route.q || '') : '');

  // Route-scoped body class → lets CSS cap prose views at --content-max-width
  // while Tabelle/Diagramm stay full-width canvases.
  const r = state.route;
  const routeClass =
    r.name === 'collection' ? `route-collection-${r.view || 'table'}`
    : r.name === 'process'   ? `route-process-${r.detailTab || 'diagram'}`
    :                          `route-${r.name}`;
  document.body.className = document.body.className
    .split(/\s+/).filter(c => !c.startsWith('route-')).concat(routeClass).join(' ').trim();

  const keepViewer = state.route.name === 'process' && state.route.detailTab === 'diagram';
  if (state.bpmnViewer && !keepViewer) {
    state.bpmnViewer.destroy();
    state.bpmnViewer = null;
  }

  renderSidebar();
  const main = document.getElementById('main-content');
  switch (state.route.name) {
    case 'home':       main.innerHTML = renderHome(); break;
    case 'search':     main.innerHTML = renderSearchResults(state.route.q || ''); break;
    case 'chat':       main.innerHTML = renderChatView(); break;
    case 'workflows':  main.innerHTML = renderWorkflowsView(); break;
    case 'recents':    main.innerHTML = renderRecents(); break;
    case 'collection':
      // Let the URL drive filter/grouping state so shared URLs reproduce
      // the sender's view. Filter changes update the URL via replaceState.
      applyCollectionRouteToState(state.route);
      main.innerHTML = renderCollection(state.route.collId, state.route.view);
      break;
    case 'process':    renderProcess(state.route.collId, state.route.processId, state.route.detailTab); break;
  }

  lucide.createIcons();
  main.focus({ preventScroll: true });
  announceRoute();
}

window.addEventListener('hashchange', handleRoute);

function announceRoute() {
  const live = document.getElementById('sr-live');
  if (!live) return;
  const h = document.querySelector('#main-content h1, #main-content h2');
  live.textContent = h?.textContent?.trim() || '';
}

// ─── Global handlers ────────────────────────────────────────────────
function wireGlobalHandlers() {
  wireSearchInput();
  wireSidebarResize();

  // Keyboard support for [data-nav] / [data-href] elements that render as
  // <div role="link"> / <tr class="clickable-row"> — those have no native
  // Enter/Space activation. Triggers a click on the focused target so the
  // single click-delegation path below stays the source of truth.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target.closest('[data-href], [data-nav]');
    if (!target) return;
    // Don't swallow keys on real controls (buttons, inputs, anchors).
    const tag = e.target.tagName;
    if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'A') return;
    e.preventDefault();
    target.click();
  });

  // After any re-render, make sure every clickable-looking element is
  // reachable by Tab. We observe the whole document once here rather than
  // threading tabindex="0" through a dozen templates.
  const focusables = '.nav-item[role="link"], tr.clickable-row, .search-dropdown-item, .search-dropdown-cta, .search-result-item, .grouping-option, .home-kpi-card[data-href]';
  const applyTabIndex = (root = document) => {
    root.querySelectorAll(focusables).forEach(el => {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    });
  };
  new MutationObserver(() => applyTabIndex()).observe(
    document.body,
    { childList: true, subtree: true }
  );
  applyTabIndex();

  document.addEventListener('click', e => {
    if (e.target.closest('#sidebar-toggle')) {
      document.body.classList.toggle('sidebar-collapsed');
      localStorage.setItem(SIDEBAR_KEY,
        document.body.classList.contains('sidebar-collapsed') ? '1' : '0');
      renderSidebar(); lucide.createIcons();
      return;
    }

    // Collection chevron toggle — must beat the parent .nav-item's data-nav.
    const collToggle = e.target.closest('[data-toggle-collection]');
    if (collToggle) {
      e.preventDefault();
      e.stopPropagation();
      const cid = collToggle.dataset.toggleCollection;
      if (state.expandedCollections.has(cid)) state.expandedCollections.delete(cid);
      else state.expandedCollections.add(cid);
      persistExpanded();
      renderSidebar();
      if (window.lucide?.createIcons) window.lucide.createIcons();
      return;
    }

    // Specific in-row interactive elements must beat the generic row-level
    // data-href below. Clicking a filterable Bereich badge inside a
    // clickable-row should add the filter, not navigate.
    const innerFilterPhase = e.target.closest('[data-filter-phase]');
    if (innerFilterPhase) {
      const collId = state.route.collId;
      if (collId && state.filters[collId]) {
        const phase = innerFilterPhase.dataset.filterPhase;
        const set = state.filters[collId].phases;
        if (set.has(phase)) set.delete(phase); else set.add(phase);
        rerenderCollection();
      }
      return;
    }

    // data-href: unified navigation hook for rows, KPIs, and similar.
    // Ignore clicks that originate on a real <a> so links still work.
    const linkTarget = e.target.closest('[data-href]');
    if (linkTarget && !e.target.closest('a')) {
      navigate(linkTarget.dataset.href); return;
    }

    const navBtn = e.target.closest('[data-nav]');
    if (navBtn) { navigate(navBtn.dataset.nav); return; }

    if (e.target.closest('#filter-toggle')) {
      const panel = document.getElementById('filter-panel');
      const pills = document.getElementById('filter-pills');
      if (!panel) return;
      const nowOpen = panel.hasAttribute('hidden');
      state.filterPanelOpen = nowOpen;
      panel.toggleAttribute('hidden', !nowOpen);
      if (pills) pills.toggleAttribute('hidden', nowOpen);
      e.target.closest('#filter-toggle').setAttribute('aria-expanded', String(nowOpen));
      return;
    }
    // Chip toggles — each filter dimension stores its selection as a
    // Set<string>. A chip click toggles membership; a pill remove deletes.
    const ownerChip = e.target.closest('[data-filter-owner]');
    if (ownerChip) {
      const set = state.filters[state.route.collId].owners;
      const v = ownerChip.dataset.filterOwner;
      if (set.has(v)) set.delete(v); else set.add(v);
      rerenderCollection(); return;
    }
    const statusChip = e.target.closest('[data-filter-status]');
    if (statusChip) {
      const set = state.filters[state.route.collId].statuses;
      const v = statusChip.dataset.filterStatus;
      if (set.has(v)) set.delete(v); else set.add(v);
      rerenderCollection(); return;
    }
    const pillPhase = e.target.closest('[data-pill-phase]');
    if (pillPhase) {
      state.filters[state.route.collId].phases.delete(pillPhase.dataset.pillPhase);
      rerenderCollection(); return;
    }
    const pillOwner = e.target.closest('[data-pill-owner]');
    if (pillOwner) {
      state.filters[state.route.collId].owners.delete(pillOwner.dataset.pillOwner);
      rerenderCollection(); return;
    }
    const pillStatus = e.target.closest('[data-pill-status]');
    if (pillStatus) {
      state.filters[state.route.collId].statuses.delete(pillStatus.dataset.pillStatus);
      rerenderCollection(); return;
    }
    if (e.target.closest('#filter-reset')) {
      state.filters[state.route.collId] = {
        phases: new Set(), owners: new Set(), statuses: new Set()
      };
      rerenderCollection(); return;
    }

    // Grouping dropdown
    if (e.target.closest('#grouping-btn')) {
      state.groupingMenuOpen = !state.groupingMenuOpen;
      state.exportMenuOpen = false;
      document.getElementById('grouping-menu')?.classList.toggle('open', state.groupingMenuOpen);
      document.getElementById('export-menu')?.classList.remove('open');
      return;
    }
    const gOpt = e.target.closest('.grouping-option[data-grouping]');
    if (gOpt) {
      state.grouping[state.route.collId] = gOpt.dataset.grouping;
      state.groupingMenuOpen = false;
      rerenderCollection(); return;
    }

    // Workflows view: per-collection export buttons
    const collExportBtn = e.target.closest('[data-export-coll]');
    if (collExportBtn) {
      const [collId, kind] = collExportBtn.dataset.exportColl.split(':');
      const c = state.collections.find(x => x.id === collId);
      if (!c) return;
      const { filtered } = buildFilterContext(c, state.filters[c.id]);
      if (kind === 'excel') exportCollectionExcel(c, filtered);
      else if (kind === 'pdf')   exportCollectionPdf(c, filtered);
      else if (kind === 'bpmn')  downloadCollectionBpmnZip(c, filtered);
      return;
    }

    // Export dropdown
    if (e.target.closest('#export-btn')) {
      state.exportMenuOpen = !state.exportMenuOpen;
      state.groupingMenuOpen = false;
      document.getElementById('export-menu')?.classList.toggle('open', state.exportMenuOpen);
      document.getElementById('grouping-menu')?.classList.remove('open');
      return;
    }
    const xOpt = e.target.closest('.grouping-option[data-export]');
    if (xOpt) {
      if (xOpt.classList.contains('disabled')) return;
      state.exportMenuOpen = false;
      document.getElementById('export-menu')?.classList.remove('open');
      dispatchExport(xOpt.dataset.export);
      return;
    }

    // Click outside any open dropdown → close all
    if ((state.groupingMenuOpen || state.exportMenuOpen) && !e.target.closest('.grouping-dropdown')) {
      state.groupingMenuOpen = false;
      state.exportMenuOpen = false;
      document.getElementById('grouping-menu')?.classList.remove('open');
      document.getElementById('export-menu')?.classList.remove('open');
    }
  });
}

// ─── Search input wiring ────────────────────────────────────────────
let searchDropdownDebounce = null;

function wireSearchInput() {
  const input = document.getElementById('search-input');
  const clearBtn = document.getElementById('search-clear');
  if (!input) return;

  const currentItems = () =>
    Array.from(document.querySelectorAll('#search-dropdown [role="option"]'));
  const currentActiveIdx = (items) =>
    items.findIndex(el => el.classList.contains('search-dropdown-item-active'));

  input.addEventListener('input', () => {
    const q = input.value;
    syncHeaderSearch(q);
    if (searchDropdownDebounce) clearTimeout(searchDropdownDebounce);
    searchDropdownDebounce = setTimeout(() => renderSearchDropdown(q), 120);
  });

  input.addEventListener('focus', () => {
    // Re-open dropdown on focus if there's any text OR the CTA-only mode.
    renderSearchDropdown(input.value);
  });

  input.addEventListener('keydown', e => {
    const dd = document.getElementById('search-dropdown');
    if (e.key === 'Escape') {
      hideSearchDropdown();
      input.blur();
      return;
    }
    if (e.key === 'Enter') {
      const items = currentItems();
      const active = items[currentActiveIdx(items)];
      if (active && active.dataset.href) {
        e.preventDefault();
        hideSearchDropdown();
        navigate(active.dataset.href);
        return;
      }
      const q = input.value.trim();
      if (q) {
        e.preventDefault();
        hideSearchDropdown();
        navigate(`#/search?q=${encodeURIComponent(q)}`);
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!dd || dd.hidden) return;
      const items = currentItems();
      if (items.length === 0) return;
      e.preventDefault();
      const cur = currentActiveIdx(items);
      const next = e.key === 'ArrowDown'
        ? (cur < items.length - 1 ? cur + 1 : 0)
        : (cur > 0 ? cur - 1 : items.length - 1);
      setSearchDropdownActive(items, next);
    }
  });

  // Close dropdown on click outside the header-search area.
  document.addEventListener('mousedown', e => {
    if (!e.target.closest('.header-search')) hideSearchDropdown();
  });

  // Clear button
  clearBtn?.addEventListener('click', () => {
    input.value = '';
    syncHeaderSearch('');
    hideSearchDropdown();
    input.focus();
  });

  // Ctrl/Cmd+K focuses search.
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}

// ─── Sidebar resize ─────────────────────────────────────────────────
function wireSidebarResize() {
  const handle = document.getElementById('sidebar-resize-handle');
  if (!handle) return;
  let startX = 0, startWidth = 0;

  const onMove = (e) => {
    const delta = e.clientX - startX;
    const w = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startWidth + delta));
    document.body.style.setProperty('--sidebar-width', w + 'px');
  };
  const onUp = () => {
    document.body.classList.remove('sidebar-resizing');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    // Persist the final width.
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
      try { localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebar.offsetWidth)); }
      catch { /* ignore */ }
    }
  };

  handle.addEventListener('mousedown', (e) => {
    if (document.body.classList.contains('sidebar-collapsed')) return;
    e.preventDefault();
    startX = e.clientX;
    startWidth = document.getElementById('sidebar')?.offsetWidth || 260;
    document.body.classList.add('sidebar-resizing');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Double-click the handle to reset to default width.
  handle.addEventListener('dblclick', () => {
    if (document.body.classList.contains('sidebar-collapsed')) return;
    document.body.style.removeProperty('--sidebar-width');
    try { localStorage.removeItem(SIDEBAR_WIDTH_KEY); } catch { /* ignore */ }
  });
}

function rerenderCollection() {
  if (state.route.name !== 'collection') return;
  // Every state change that triggers a rerender should leave the URL
  // reflecting current filters/grouping — so a reload or a shared link
  // lands on the exact same view.
  syncCollectionUrl();
  document.getElementById('main-content').innerHTML =
    renderCollection(state.route.collId, state.route.view);
  lucide.createIcons();
}

// ─── Sidebar ────────────────────────────────────────────────────────
function renderSidebar() {
  const collapsed = document.body.classList.contains('sidebar-collapsed');
  const r = state.route;

  let html = `
    ${navItem('home', 'Home', r.name === 'home', '#/')}
    ${navItem('sparkles', 'KI-Assistent', r.name === 'chat', '#/chat')}
    ${navItem('workflow', 'Workflows & API', r.name === 'workflows', '#/workflows')}

    <div class="nav-divider sidebar-collapsed-hide"></div>
    <div class="nav-section-label">Prozess-Sammlungen</div>
  `;

  for (const c of state.collections) {
    const onThis = (r.name === 'collection' || r.name === 'process') && r.collId === c.id;
    // Auto-expand the collection the user is currently inside.
    if (onThis) state.expandedCollections.add(c.id);
    const expanded = state.expandedCollections.has(c.id);
    const count = totalProcesses(c.landscape);
    // The collection row itself is only "active" when we're on its overview,
    // not when we're deep in one of its processes (child row handles that).
    const rowActive = r.name === 'collection' && r.collId === c.id;

    html += `
      <div class="nav-item ${rowActive ? 'active' : ''}" data-nav="${collectionHrefFor(c.id)}"
           role="link" title="${escapeAttr(c.name)}">
        <button type="button" class="nav-chevron sidebar-collapsed-hide" data-toggle-collection="${escapeAttr(c.id)}"
                aria-expanded="${expanded}" aria-label="${expanded ? 'Einklappen' : 'Ausklappen'}">
          <i data-lucide="chevron-${expanded ? 'down' : 'right'}" style="width:14px;height:14px;"></i>
        </button>
        <i data-lucide="folder-tree" class="nav-item-icon-compact" style="width:16px;height:16px;flex-shrink:0;"></i>
        <span>${escapeHtml(c.name)}</span>
        <span class="nav-count">${count}</span>
      </div>`;

    if (expanded) {
      // Flatten all processes and sort by id (natural order: 1.1b < 2.1b; TQ.21.00.00.02 < TQ.21.00.00.15).
      const procs = [];
      for (const a of c.landscape.areas) for (const g of a.groups) procs.push(g);
      procs.sort((x, y) => x.id.localeCompare(y.id, undefined, { numeric: true }));
      for (const g of procs) {
        const procActive = r.name === 'process' && r.collId === c.id && r.processId === g.id;
        html += `
          <div class="nav-item nav-item-child sidebar-collapsed-hide ${procActive ? 'active' : ''}"
               data-nav="${processHrefFor(c.id, g.id)}"
               role="link" title="${escapeAttr(g.id + ' ' + g.name)}">
            <code class="nav-child-id">${escapeHtml(g.id)}</code>
            <span>${escapeHtml(g.name)}</span>
          </div>`;
      }
    }
  }

  if (state.recents.length > 0) {
    html += '<div class="nav-divider sidebar-collapsed-hide"></div>';
    html += '<div class="nav-section-label">Zuletzt angesehen</div>';
    state.recents.slice(0, 5).forEach(rec => {
      html += `<div class="nav-recent-item" data-nav="${escapeAttr(rec.hash)}" title="${escapeAttr(rec.title)}">${escapeHtml(rec.title)}</div>`;
    });
  }

  // Sticky footer with the collapse/expand toggle.
  html += `
    <div class="sidebar-footer">
      <button type="button" class="sidebar-toggle" id="sidebar-toggle"
        aria-label="${collapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'}"
        aria-expanded="${!collapsed}">
        <i data-lucide="chevron-left" style="width:16px;height:16px;"></i>
      </button>
    </div>
  `;

  document.getElementById('sidebar').innerHTML = html;
}

function navItem(icon, label, active, hash) {
  return `<div class="nav-item ${active ? 'active' : ''}" data-nav="${escapeAttr(hash)}" role="link" title="${escapeAttr(label)}">
    <i data-lucide="${icon}" style="width:16px;height:16px;flex-shrink:0;"></i>
    <span>${escapeHtml(label)}</span>
  </div>`;
}

// ─── Home view ──────────────────────────────────────────────────────
function totalProcesses(landscape) {
  return landscape.areas.reduce((n, a) => n + a.groups.length, 0);
}
function processesWithBpmn(landscape) {
  return landscape.areas.reduce((n, a) => n + a.groups.filter(g => !!g.bpmn).length, 0);
}

// ─── Collection landing ─────────────────────────────────────────────
function resolvePerson(id) {
  return state.people[id] || null;
}

// ─── Export dropdown + handlers ─────────────────────────────────────
function renderRecents() {
  if (state.recents.length === 0) {
    return `<div class="content-wrapper">
      ${renderBreadcrumb([{ label: 'Home', hash: '#/' }, { label: 'Zuletzt angesehen' }])}
      <h1 class="title-block-name" style="margin-bottom: var(--space-4);">Zuletzt angesehen</h1>
      <p class="text-secondary">Noch keine Prozesse geöffnet.</p>
    </div>`;
  }
  return `<div class="content-wrapper">
    ${renderBreadcrumb([{ label: 'Home', hash: '#/' }, { label: 'Zuletzt angesehen' }])}
    <h1 class="title-block-name" style="margin-bottom: var(--space-4);">Zuletzt angesehen</h1>
    <ul class="recents-list">
      ${state.recents.map(r => `
        <li><a href="${escapeAttr(r.hash)}" class="recents-list-item">
          <i data-lucide="file-text" style="width:16px;height:16px;"></i>
          <span>${escapeHtml(r.title)}</span>
        </a></li>`).join('')}
    </ul>
  </div>`;
}

// ─── Shared helpers ─────────────────────────────────────────────────
function renderBreadcrumb(items) {
  return `<nav class="breadcrumb" aria-label="Brotkrumen">
    ${items.map((it, i) => {
      const last = i === items.length - 1;
      if (last) return `<span class="breadcrumb-current">${escapeHtml(it.label)}</span>`;
      return `<a class="breadcrumb-link" href="${escapeAttr(it.hash)}">${escapeHtml(it.label)}</a>
              <span class="breadcrumb-separator">›</span>`;
    }).join('')}
  </nav>`;
}

function findGroupInCollection(c, groupId) {
  for (const area of c.landscape.areas) {
    const group = area.groups.find(g => g.id === groupId);
    if (group) return { area, group };
  }
  return null;
}

function addRecent(entry) {
  state.recents = state.recents.filter(r => r.hash !== entry.hash);
  state.recents.unshift(entry);
  if (state.recents.length > 8) state.recents.length = 8;
  persistRecents();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}
function escapeAttr(s) { return escapeHtml(s); }
