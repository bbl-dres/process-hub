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

    const landscapes = await Promise.all(
      index.collections.map(c => fetch(c.file).then(r => {
        if (!r.ok) throw new Error(`${c.file}: ${r.status}`);
        return r.json();
      }))
    );
    state.collections = index.collections.map((c, i) => ({ ...c, landscape: landscapes[i] }));
    state.collections.forEach(c => {
      state.filters[c.id] = { phases: new Set(), status: 'all' };
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
    if (Array.isArray(r)) state.recents = r.slice(0, 8);
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
  return (v && v !== 'table') ? `${base}/${v}` : base;
}

function showFatalError(err) {
  document.getElementById('loading-screen').innerHTML = `
    <div style="max-width: 480px; text-align: center; padding: 32px;">
      <h2 style="margin-bottom: 12px; color: var(--color-text-primary);">Daten konnten nicht geladen werden</h2>
      <p style="color: var(--color-text-secondary); margin-bottom: 8px;">${escapeHtml(err.message)}</p>
      <p style="color: var(--color-text-secondary); font-size: var(--text-small);">
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
    return { name: 'collection', collId, view };
  }
  return { name: 'home' };
}

function handleRoute() {
  state.route = parseRoute();
  state.filterPanelOpen = false;
  hideSearchDropdown();
  syncHeaderSearch(state.route.name === 'search' ? (state.route.q || '') : '');
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
    case 'collection': main.innerHTML = renderCollection(state.route.collId, state.route.view); break;
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
    const statusChip = e.target.closest('[data-filter-status]');
    if (statusChip) {
      state.filters[state.route.collId].status = statusChip.dataset.filterStatus;
      rerenderCollection(); return;
    }
    const pillRemove = e.target.closest('[data-pill-phase]');
    if (pillRemove) {
      state.filters[state.route.collId].phases.delete(pillRemove.dataset.pillPhase);
      rerenderCollection(); return;
    }
    if (e.target.closest('[data-pill-status]')) {
      state.filters[state.route.collId].status = 'all';
      rerenderCollection(); return;
    }
    if (e.target.closest('#filter-reset')) {
      state.filters[state.route.collId] = { phases: new Set(), status: 'all' };
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
        <button type="button" class="nav-chevron" data-toggle-collection="${escapeAttr(c.id)}"
                aria-expanded="${expanded}" aria-label="${expanded ? 'Einklappen' : 'Ausklappen'}">
          <i data-lucide="chevron-${expanded ? 'down' : 'right'}" style="width:14px;height:14px;"></i>
        </button>
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
function renderHome() {
  const kpis = computeKpis();

  const kpiCards = [
    { icon: 'folder-tree',  count: kpis.collections, label: 'Sammlungen', sub: 'Prozess-Sammlungen' },
    { icon: 'list-tree',    count: kpis.processes,   label: 'Prozesse',   sub: 'Gesamtzahl Teilprozesse' },
    { icon: 'file-check',   count: kpis.withBpmn,    label: 'Mit Diagramm', sub: 'BPMN verfügbar' },
    { icon: 'file-x',       count: kpis.withoutBpmn, label: 'Ohne Diagramm', sub: 'Kein BPMN hinterlegt' },
    { icon: 'layers',       count: kpis.areas,       label: 'Bereiche',   sub: 'Level-2-Gruppierungen' },
  ];

  return `
    <div class="content-wrapper">
      <div class="title-block">
        <div class="title-block-icon">
          <i data-lucide="workflow" style="width:20px;height:20px;"></i>
        </div>
        <div class="title-block-content">
          <h1 class="title-block-name">Prozess-Hub</h1>
          <div class="title-block-subtitle">Durchsuchen und verstehen Sie die Prozesslandschaft verschiedener Sammlungen.</div>
        </div>
      </div>

      <div class="home-kpi-grid">
        ${kpiCards.map(k => `
          <div class="home-kpi-card" ${k.href ? `data-href="${escapeAttr(k.href)}" tabindex="0" role="link"` : ''}>
            <div class="home-kpi-icon"><i data-lucide="${k.icon}" style="width:18px;height:18px;"></i></div>
            <div class="home-kpi-count">${k.count}</div>
            <div class="home-kpi-label">${escapeHtml(k.label)}</div>
            <div class="home-kpi-sub">${escapeHtml(k.sub)}</div>
          </div>
        `).join('')}
      </div>

      <div class="section-label">Prozess-Sammlungen</div>
      <div class="list-panel">
        <div class="data-table-wrap">
          <table class="data-table">
            <colgroup>
              <col>
              <col style="width: 200px;">
              <col style="width: 110px;">
              <col style="width: 140px;">
              <col style="width: 140px;">
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Bereiche</th>
                <th scope="col">Prozesse</th>
                <th scope="col">Mit Diagramm</th>
                <th scope="col">Aktualisiert</th>
              </tr>
            </thead>
            <tbody>
              ${state.collections.map(renderCollectionRow).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="section-label" style="margin-top: var(--space-6);">Letzte Aktivitäten</div>
      ${renderRecentActivityTable()}
    </div>
  `;
}

function renderRecentActivityTable() {
  const all = [];
  state.collections.forEach(c => {
    c.landscape.areas.forEach(a => {
      a.groups.forEach(g => {
        if (g.updatedAt) all.push({ c, a, g });
      });
    });
  });
  if (all.length === 0) {
    return `<p style="color: var(--color-text-secondary);">Keine Aktivitäten erfasst.</p>`;
  }
  all.sort((x, y) => (y.g.updatedAt || '').localeCompare(x.g.updatedAt || ''));
  const top = all.slice(0, 5);
  return `
    <div class="list-panel">
      <div class="data-table-wrap">
        <table class="data-table">
          <colgroup>
            <col style="width: 140px;">
            <col>
            <col style="width: 220px;">
            <col style="width: 140px;">
            <col style="width: 130px;">
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Nr.</th>
              <th scope="col">Prozess</th>
              <th scope="col">Sammlung</th>
              <th scope="col">Status</th>
              <th scope="col">Aktualisiert</th>
            </tr>
          </thead>
          <tbody>
            ${top.map(({ c, a, g }) => {
              const href = `#/c/${encodeURIComponent(c.id)}/process/${encodeURIComponent(g.id)}`;
              return `
                <tr class="clickable-row" data-href="${escapeAttr(href)}">
                  <td style="font-variant-numeric: tabular-nums;">${escapeHtml(g.id)}</td>
                  <td>${escapeHtml(g.name)}</td>
                  <td>${escapeHtml(c.name)}</td>
                  <td>${renderStatusBadge(g.status)}</td>
                  <td>${escapeHtml(g.updatedAt)}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderCollectionRow(c) {
  const count = totalProcesses(c.landscape);
  const bpmn = processesWithBpmn(c.landscape);
  const href = `#/c/${encodeURIComponent(c.id)}`;
  return `
    <tr class="clickable-row" data-href="${escapeAttr(href)}">
      <td>
        <div style="font-weight:500;">${escapeHtml(c.name)}</div>
        ${c.subtitle ? `<div style="font-size: var(--text-small); color: var(--color-text-secondary);">${escapeHtml(c.subtitle)}</div>` : ''}
      </td>
      <td style="font-variant-numeric: tabular-nums;">${c.landscape.areas.length}</td>
      <td style="font-variant-numeric: tabular-nums;">${count}</td>
      <td style="font-variant-numeric: tabular-nums;">${bpmn}</td>
      <td style="color: var(--color-text-secondary); font-size: var(--text-small);">${escapeHtml(c.updatedAt || '—')}</td>
    </tr>
  `;
}

function computeKpis() {
  let processes = 0, withBpmn = 0, withoutBpmn = 0, areas = 0;
  state.collections.forEach(c => {
    areas += c.landscape.areas.length;
    c.landscape.areas.forEach(a => a.groups.forEach(g => {
      processes++;
      if (g.bpmn) withBpmn++; else withoutBpmn++;
    }));
  });
  return { collections: state.collections.length, processes, withBpmn, withoutBpmn, areas };
}

function totalProcesses(landscape) {
  return landscape.areas.reduce((n, a) => n + a.groups.length, 0);
}
function processesWithBpmn(landscape) {
  return landscape.areas.reduce((n, a) => n + a.groups.filter(g => !!g.bpmn).length, 0);
}

// ─── Collection landing ─────────────────────────────────────────────
function renderCollection(collId, view) {
  const c = state.collections.find(x => x.id === collId);
  if (!c) return `<div class="content-wrapper"><p>Sammlung nicht gefunden.</p></div>`;
  const filters = state.filters[collId];
  const f = buildFilterContext(c, filters);

  return `
    <div class="content-wrapper">
      ${renderBreadcrumb([
        { label: 'Home', hash: '#/' },
        { label: c.name }
      ])}

      <div class="title-block">
        <div class="title-block-icon">
          <i data-lucide="folder-tree" style="width:20px;height:20px;"></i>
        </div>
        <div class="title-block-content">
          <h1 class="title-block-name">${escapeHtml(c.name)}</h1>
          ${c.subtitle ? `<div class="title-block-subtitle">${escapeHtml(c.subtitle)}</div>` : ''}
        </div>
      </div>

      <div class="tab-bar" role="tablist">
        <div class="tab-bar-scroll">
          <button class="tab ${view === 'table' ? 'active' : ''}" data-nav="#/c/${encodeURIComponent(c.id)}/table" role="tab" aria-selected="${view === 'table'}">Tabelle</button>
          <button class="tab ${view === 'diagram' ? 'active' : ''}" data-nav="#/c/${encodeURIComponent(c.id)}/diagram" role="tab" aria-selected="${view === 'diagram'}">Diagramm</button>
          <button class="tab ${view === 'metadata' ? 'active' : ''}" data-nav="#/c/${encodeURIComponent(c.id)}/metadata" role="tab" aria-selected="${view === 'metadata'}">Metadaten</button>
        </div>
        ${view !== 'metadata' ? f.toggleHtml : ''}
        ${view === 'table' ? renderGroupingDropdown(c.id) : ''}
        ${renderExportDropdown('collection', f.filtered)}
      </div>

      ${view !== 'metadata' ? f.pillsHtml : ''}
      ${view !== 'metadata' ? f.panelHtml : ''}

      ${view === 'diagram' ? renderDiagramView(c, f.filtered)
        : view === 'metadata' ? renderCollectionMetadataView(c)
        : renderTableView(c, f.filtered)}
    </div>
  `;
}

function renderCollectionMetadataView(c) {
  const ownerHtml = c.owner
    ? (c.ownerUrl
        ? `<a href="${escapeAttr(c.ownerUrl)}" target="_blank" rel="noopener">${escapeHtml(c.owner)}</a>`
        : escapeHtml(c.owner))
    : '<span style="color: var(--color-text-placeholder);">—</span>';

  return `
    <section class="content-section">
      <div class="section-label">Beschreibung</div>
      ${c.description
        ? `<p style="margin:0; max-width: var(--prose-max-width); line-height:1.6;">${escapeHtml(c.description)}</p>`
        : `<p style="margin:0; color: var(--color-text-placeholder);">Keine Beschreibung hinterlegt.</p>`}
    </section>

    <section class="content-section">
      <div class="section-label">Herausgeber</div>
      <table class="props-table">
        <tbody>
          <tr>
            <th scope="row">Sammlung</th>
            <td>${escapeHtml(c.name)}</td>
          </tr>
          ${c.subtitle ? `<tr><th scope="row">Untertitel</th><td>${escapeHtml(c.subtitle)}</td></tr>` : ''}
          <tr>
            <th scope="row">Quelle</th>
            <td>${ownerHtml}</td>
          </tr>
          <tr>
            <th scope="row">Aktualisiert</th>
            <td>${escapeHtml(c.updatedAt || '—')}</td>
          </tr>
        </tbody>
      </table>
    </section>

  `;
}

function buildFilterContext(c, filters) {
  const filtered = c.landscape.areas.map(a => ({
    ...a,
    groups: a.groups.filter(g => {
      if (filters.phases.size > 0 && !filters.phases.has(a.id)) return false;
      if (filters.status === 'active'   && !g.bpmn) return false;
      if (filters.status === 'inactive' &&  g.bpmn) return false;
      return true;
    })
  })).filter(a => a.groups.length > 0);

  const activeCount = filters.phases.size + (filters.status !== 'all' ? 1 : 0);

  const panelOpen = state.filterPanelOpen;

  const toggleHtml = `
    <button type="button" class="grouping-btn filter-toggle" id="filter-toggle" aria-expanded="${panelOpen}" aria-controls="filter-panel">
      <i data-lucide="filter" style="width:14px;height:14px;"></i>
      <span>Filter</span>
      ${activeCount > 0 ? `<span class="filter-toggle-badge">${activeCount}</span>` : ''}
      <i data-lucide="chevron-down" style="width:14px;height:14px;"></i>
    </button>
  `;

  let pills = '';
  filters.phases.forEach(phaseId => {
    const a = c.landscape.areas.find(x => x.id === phaseId);
    if (!a) return;
    pills += `<span class="filter-pill">
      <span class="filter-pill-dim">Bereich:</span>
      <span class="filter-pill-val">${escapeHtml(a.name)}</span>
      <button type="button" class="filter-pill-remove" data-pill-phase="${escapeAttr(phaseId)}" aria-label="Filter entfernen"><i data-lucide="x" style="width:10px;height:10px;"></i></button>
    </span>`;
  });
  if (filters.status !== 'all') {
    pills += `<span class="filter-pill">
      <span class="filter-pill-dim">Status:</span>
      <span class="filter-pill-val">${filters.status === 'active' ? 'Mit Diagramm' : 'Ohne Diagramm'}</span>
      <button type="button" class="filter-pill-remove" data-pill-status="1" aria-label="Filter entfernen"><i data-lucide="x" style="width:10px;height:10px;"></i></button>
    </span>`;
  }
  const pillsHidden = activeCount === 0 || panelOpen;
  const pillsHtml = activeCount > 0
    ? `<div class="filter-pill-row" id="filter-pills" ${pillsHidden ? 'hidden' : ''}>${pills}<button type="button" class="filter-reset" id="filter-reset">Alle entfernen</button></div>`
    : '';

  const panelHtml = `
    <div class="filter-panel" id="filter-panel" ${panelOpen ? '' : 'hidden'}>
      <div class="filter-group">
        <div class="filter-group-label">Bereich</div>
        <div class="filter-group-options">
          ${c.landscape.areas.map(a => {
            const active = filters.phases.has(a.id);
            return `<label class="filter-chip ${active ? 'active' : ''}">
              <input type="checkbox" data-filter-phase="${escapeAttr(a.id)}" ${active ? 'checked' : ''}>
              <span>${escapeHtml(a.name)}</span>
              <span class="filter-chip-count">${a.groups.length}</span>
            </label>`;
          }).join('')}
        </div>
      </div>
      <div class="filter-group">
        <div class="filter-group-label">Status</div>
        <div class="filter-group-options">
          ${['all', 'active', 'inactive'].map(s => {
            const active = filters.status === s;
            const label = s === 'all' ? 'Alle' : s === 'active' ? 'Mit Diagramm' : 'Ohne Diagramm';
            return `<label class="filter-chip ${active ? 'active' : ''}">
              <input type="radio" name="status" data-filter-status="${s}" ${active ? 'checked' : ''}>
              <span>${escapeHtml(label)}</span>
            </label>`;
          }).join('')}
        </div>
      </div>
    </div>
  `;

  return { filtered, toggleHtml, pillsHtml, panelHtml };
}

function renderDiagramView(c, areas) {
  if (areas.length === 0) {
    return `<div class="empty-state">Keine Prozesse passen zu den aktuellen Filtern.</div>`;
  }
  return `
    <section class="landscape-diagram">
      <div class="landscape-canvas">
        ${areas.map(a => renderAreaCard(c, a)).join('')}
      </div>
    </section>
  `;
}

function renderAreaCard(c, area) {
  return `
    <section class="area-card" style="--area-accent:${area.accent || 'var(--color-border-strong)'}">
      <header class="area-card-header">
        <span class="area-card-number">${escapeHtml(area.number || '')}</span>
        <h3 class="area-card-title">${escapeHtml(area.name)}</h3>
      </header>
      <div class="tile-grid">
        ${area.groups.map(g => renderTile(c, g)).join('')}
      </div>
    </section>
  `;
}

function renderTile(c, group) {
  const href = `#/c/${encodeURIComponent(c.id)}/process/${encodeURIComponent(group.id)}`;
  return `
    <a href="${href}" class="tile" aria-label="${escapeAttr(group.name)}">
      <div class="tile-number">${escapeHtml(group.id)}</div>
      <div class="tile-name">${escapeHtml(group.name)}</div>
    </a>
  `;
}

function renderTableView(c, areas) {
  const rows = [];
  areas.forEach(a => a.groups.forEach(g => rows.push({ a, g })));
  if (rows.length === 0) {
    return `<div class="empty-state">Keine Prozesse passen zu den aktuellen Filtern.</div>`;
  }

  const grouping = state.grouping[c.id] || 'area';
  const groups = groupRows(rows, grouping, c);

  return `
    <div class="list-panel">
      ${groups.map(gr => `
        ${gr.label !== null ? `
          <div class="group-header">
            <i data-lucide="chevron-down" style="width:16px;height:16px;"></i>
            <span class="group-header-title">${escapeHtml(gr.label)} (${gr.rows.length})</span>
          </div>
        ` : ''}
        <div class="group-content">
          ${renderProcessTable(c, gr.rows)}
        </div>
      `).join('')}
    </div>
  `;
}

function renderProcessTable(c, rows) {
  return `
    <div class="data-table-wrap">
      <table class="data-table">
        <colgroup>
          <col style="width: 170px;">
          <col>
          <col style="width: 260px;">
          <col style="width: 260px;">
          <col style="width: 180px;">
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Nr.</th>
            <th scope="col">Prozess</th>
            <th scope="col">Bereich</th>
            <th scope="col">Owner</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(({ a, g }) => renderProcessRow(c, a, g)).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderProcessRow(c, a, g) {
  const href = `#/c/${encodeURIComponent(c.id)}/process/${encodeURIComponent(g.id)}`;
  const owner = g.owner ? resolvePerson(g.owner) : null;
  const filterActive = state.filters[c.id]?.phases.has(a.id);
  return `
    <tr class="clickable-row" data-href="${escapeAttr(href)}">
      <td style="font-variant-numeric: tabular-nums;">${escapeHtml(g.id)}</td>
      <td>${escapeHtml(g.name)}</td>
      <td>
        <button type="button" class="badge badge-domain badge-filterable"
                data-filter-phase="${escapeAttr(a.id)}"
                ${filterActive ? 'aria-pressed="true"' : ''}
                title="Nach Bereich filtern">${escapeHtml(a.name)}</button>
      </td>
      <td>${owner ? escapeHtml(owner.name) : '<span style="color: var(--color-text-placeholder);">—</span>'}</td>
      <td>${renderStatusBadge(g.status)}</td>
    </tr>`;
}

function renderStatusBadge(status) {
  if (!status) return '<span style="color: var(--color-text-placeholder);">—</span>';
  const s = STATUS_LABELS[status];
  if (!s) return escapeHtml(status);
  return `<span class="badge ${s.badge}">${escapeHtml(s.label)}</span>`;
}

function renderGroupingDropdown(collId) {
  const active = state.grouping[collId] || 'area';
  const activeLabel = GROUPING_OPTIONS.find(o => o.id === active)?.label || 'Bereich';
  return `
    <div class="grouping-dropdown">
      <button type="button" class="grouping-btn" id="grouping-btn">
        Gruppierung: ${escapeHtml(activeLabel)}
        <i data-lucide="chevron-down" style="width:14px;height:14px;"></i>
      </button>
      <div class="grouping-menu ${state.groupingMenuOpen ? 'open' : ''}" id="grouping-menu">
        ${GROUPING_OPTIONS.map(o => `
          <div class="grouping-option ${o.id === active ? 'active' : ''}" data-grouping="${escapeAttr(o.id)}">${escapeHtml(o.label)}</div>
        `).join('')}
      </div>
    </div>
  `;
}

function groupRows(rows, grouping, c) {
  if (grouping === 'none') {
    return [{ label: null, rows }];
  }

  const keyFn = {
    area:   ({ a }) => ({ key: a.id, label: a.name }),
    owner:  ({ g }) => {
      if (!g.owner) return { key: '__none', label: 'Ohne Owner' };
      const p = resolvePerson(g.owner);
      return { key: g.owner, label: p ? p.name : g.owner };
    },
    status: ({ g }) => {
      if (!g.status) return { key: '__none', label: 'Ohne Status' };
      const s = STATUS_LABELS[g.status];
      return { key: g.status, label: s ? s.label : g.status };
    },
    tag:    ({ g }) => {
      const t = g.tags?.[0];
      if (!t) return { key: '__none', label: 'Ohne Tag' };
      return { key: t, label: t };
    }
  }[grouping] || (({ a }) => ({ key: a.id, label: a.name }));

  const map = new Map();
  rows.forEach(r => {
    const { key, label } = keyFn(r);
    if (!map.has(key)) map.set(key, { label, rows: [] });
    map.get(key).rows.push(r);
  });

  const out = [...map.values()];
  // Keep 'area' grouping in the data's natural order; others: alpha, with "Ohne …" last.
  if (grouping !== 'area') {
    out.sort((x, y) => {
      const xNone = /^Ohne /.test(x.label);
      const yNone = /^Ohne /.test(y.label);
      if (xNone !== yNone) return xNone ? 1 : -1;
      return x.label.localeCompare(y.label, 'de');
    });
  }
  return out;
}

function resolvePerson(id) {
  return state.people[id] || null;
}

// ─── Export dropdown + handlers ─────────────────────────────────────
function renderExportDropdown(context, payload) {
  const hasBpmn = context === 'process'
    ? !!payload?.group?.bpmn
    : (payload || []).some(a => a.groups.some(g => g.bpmn));
  const bpmnLabel = context === 'process' ? 'BPMN herunterladen' : 'BPMN als ZIP herunterladen';
  const disabledClass = hasBpmn ? '' : 'disabled';

  return `
    <div class="grouping-dropdown">
      <button type="button" class="grouping-btn" id="export-btn" aria-expanded="${state.exportMenuOpen}" aria-controls="export-menu">
        <i data-lucide="download" style="width:14px;height:14px;"></i>
        Export
        <i data-lucide="chevron-down" style="width:14px;height:14px;"></i>
      </button>
      <div class="grouping-menu ${state.exportMenuOpen ? 'open' : ''}" id="export-menu">
        <div class="grouping-option" data-export="excel">Als Excel (.xlsx)</div>
        <div class="grouping-option" data-export="pdf">Als PDF</div>
        <div class="grouping-option ${disabledClass}" data-export="bpmn">${escapeHtml(bpmnLabel)}</div>
      </div>
    </div>
  `;
}

function dispatchExport(kind) {
  const r = state.route;
  if (r.name === 'collection') {
    const c = state.collections.find(x => x.id === r.collId);
    if (!c) return;
    const { filtered } = buildFilterContext(c, state.filters[c.id]);
    if (kind === 'excel') return exportCollectionExcel(c, filtered);
    if (kind === 'pdf')   return exportCollectionPdf(c, filtered);
    if (kind === 'bpmn')  return downloadCollectionBpmnZip(c, filtered);
  } else if (r.name === 'process') {
    const c = state.collections.find(x => x.id === r.collId);
    if (!c) return;
    const found = findGroupInCollection(c, r.processId);
    if (!found) return;
    if (kind === 'excel') return exportProcessExcel(c, found.area, found.group);
    if (kind === 'pdf')   return exportProcessPdf(c, found.area, found.group);
    if (kind === 'bpmn')  return downloadProcessBpmn(found.group);
  }
}

// ─── Excel exports ──────────────────────────────────────────────────
function exportProcessExcel(c, area, group) {
  return withBusy('Excel wird erstellt…', async () => {
    const wb = XLSX.utils.book_new();
    const wsMeta = XLSX.utils.aoa_to_sheet(processMetadataRows(c, area, group));
    wsMeta['!cols'] = [{ wch: 24 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, wsMeta, 'Metadaten');

    if (group.bpmn) {
      try {
        const steps = await fetchAndParseSteps(group.bpmn);
        const rows = steps.map((s, i) => ({
          'Nr.': i + 1, 'Name': s.name || '', 'Typ': s.typeLabel, 'Rolle': s.lane || ''
        }));
        const wsSteps = XLSX.utils.json_to_sheet(rows);
        wsSteps['!cols'] = [{ wch: 6 }, { wch: 40 }, { wch: 22 }, { wch: 30 }];
        XLSX.utils.book_append_sheet(wb, wsSteps, 'Schritte');
      } catch (err) {
        console.warn('Step parse failed:', err);
      }
    }
    XLSX.writeFile(wb, `${sanitizeFilename(group.id)}.xlsx`);
  });
}

function exportCollectionExcel(c, filtered) {
  return withBusy('Excel wird erstellt…', async () => {
    const all = [];
    filtered.forEach(a => a.groups.forEach(g => all.push({ a, g })));

    const procRows = all.map(({ a, g }) => ({
      'Prozess-ID':   g.id,
      'Name':         g.name,
      'Bereich':      a.name,
      'Status':       STATUS_LABELS[g.status]?.label || g.status || '',
      'Version':      g.version || '',
      'Aktualisiert': g.updatedAt || '',
      'Owner':        resolvePerson(g.owner)?.name || '',
      'Responsible':  (g.responsible || []).map(id => resolvePerson(id)?.name).filter(Boolean).join(', '),
      'Expert':       resolvePerson(g.expert)?.name || '',
      'Tags':         (g.tags || []).join(', '),
      'Beschreibung': g.description || '',
      'BPMN-Datei':   g.bpmn || ''
    }));

    const wb = XLSX.utils.book_new();
    const wsProc = XLSX.utils.json_to_sheet(procRows);
    wsProc['!cols'] = [
      { wch: 20 }, { wch: 40 }, { wch: 20 }, { wch: 14 }, { wch: 10 },
      { wch: 14 }, { wch: 22 }, { wch: 30 }, { wch: 22 }, { wch: 30 },
      { wch: 60 }, { wch: 40 }
    ];
    XLSX.utils.book_append_sheet(wb, wsProc, 'Prozesse');

    const stepsNested = await Promise.all(all
      .filter(({ g }) => g.bpmn)
      .map(async ({ g }) => {
        try {
          const steps = await fetchAndParseSteps(g.bpmn);
          return steps.map((s, i) => ({
            'Prozess-ID':   g.id,
            'Prozess-Name': g.name,
            'Nr.':          i + 1,
            'Schritt-Name': s.name || '',
            'Typ':          s.typeLabel,
            'Rolle':        s.lane || ''
          }));
        } catch { return []; }
      }));
    const allSteps = stepsNested.flat();
    if (allSteps.length) {
      const wsSteps = XLSX.utils.json_to_sheet(allSteps);
      wsSteps['!cols'] = [
        { wch: 20 }, { wch: 40 }, { wch: 6 }, { wch: 40 }, { wch: 22 }, { wch: 30 }
      ];
      XLSX.utils.book_append_sheet(wb, wsSteps, 'Schritte');
    }

    XLSX.writeFile(wb, `${sanitizeFilename(c.id)}.xlsx`);
  });
}

function processMetadataRows(c, area, group) {
  return [
    ['Feld', 'Wert'],
    ['Prozess-ID',   group.id],
    ['Name',         group.name],
    ['Sammlung',     c.name],
    ['Bereich',      area.name],
    ['Status',       STATUS_LABELS[group.status]?.label || group.status || ''],
    ['Version',      group.version || ''],
    ['Aktualisiert', group.updatedAt || ''],
    ['Owner',        resolvePerson(group.owner)?.name || ''],
    ['Responsible',  (group.responsible || []).map(id => resolvePerson(id)?.name).filter(Boolean).join(', ')],
    ['Expert',       resolvePerson(group.expert)?.name || ''],
    ['Tags',         (group.tags || []).join(', ')],
    ['Beschreibung', group.description || ''],
    ['BPMN-Datei',   group.bpmn || '']
  ];
}

// ─── PDF exports (simple v1 layout) ─────────────────────────────────
function exportProcessPdf(c, area, group) {
  return withBusy('PDF wird erstellt…', async () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    let steps = [];
    if (group.bpmn) {
      try { steps = await fetchAndParseSteps(group.bpmn); } catch { /* ignore */ }
    }
    renderProcessPdfPage(doc, c, area, group, steps, { idx: 1, total: 1 });
    doc.save(`${sanitizeFilename(group.id)}.pdf`);
  });
}

function exportCollectionPdf(c, filtered) {
  return withBusy('PDF wird erstellt…', async () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const procs = [];
    filtered.forEach(a => a.groups.forEach(g => procs.push({ a, g })));
    if (procs.length === 0) {
      doc.setFontSize(14).text('Keine Prozesse in der aktuellen Auswahl.', 20, 30);
      doc.save(`${sanitizeFilename(c.id)}.pdf`);
      return;
    }
    procs.forEach((item, i) => {
      if (i > 0) doc.addPage();
      renderProcessPdfPage(doc, c, item.a, item.g, [], { idx: i + 1, total: procs.length });
    });
    doc.save(`${sanitizeFilename(c.id)}.pdf`);
  });
}

function renderProcessPdfPage(doc, c, area, group, steps, ctx) {
  const margin = 20;
  const pageW = doc.internal.pageSize.getWidth();

  // Title
  doc.setFontSize(16).setFont('helvetica', 'bold').setTextColor(20);
  doc.text(doc.splitTextToSize(group.name, pageW - 2 * margin), margin, margin + 2);
  doc.setFontSize(10).setFont('helvetica', 'normal').setTextColor(100);
  doc.text(`${group.id}  ·  ${c.name}  ·  ${area.name}`, margin, margin + 10);

  // Metadata table
  const ownerName = resolvePerson(group.owner)?.name || '—';
  const respNames = (group.responsible || []).map(id => resolvePerson(id)?.name).filter(Boolean).join(', ') || '—';
  const expertName = resolvePerson(group.expert)?.name || '—';

  doc.autoTable({
    startY: margin + 15,
    head: [['Feld', 'Wert']],
    body: [
      ['Status',       STATUS_LABELS[group.status]?.label || group.status || '—'],
      ['Version',      group.version || '—'],
      ['Aktualisiert', group.updatedAt || '—'],
      ['Owner',        ownerName],
      ['Responsible',  respNames],
      ['Expert',       expertName],
      ['Tags',         (group.tags || []).join(', ') || '—']
    ],
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 2 },
    headStyles: { fillColor: [240, 240, 240], textColor: 80, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 40, fontStyle: 'bold' } },
    margin: { left: margin, right: margin }
  });

  let y = (doc.lastAutoTable?.finalY || margin + 15) + 8;

  if (group.description) {
    doc.setFontSize(12).setFont('helvetica', 'bold').setTextColor(20);
    doc.text('Zweck / Bemerkungen', margin, y);
    doc.setFontSize(10).setFont('helvetica', 'normal').setTextColor(40);
    const lines = doc.splitTextToSize(group.description, pageW - 2 * margin);
    doc.text(lines, margin, y + 6);
    y = y + 6 + lines.length * 5 + 6;
  }

  if (steps.length > 0) {
    doc.setFontSize(12).setFont('helvetica', 'bold').setTextColor(20);
    doc.text('Schritte', margin, y);
    doc.autoTable({
      startY: y + 3,
      head: [['Nr.', 'Name', 'Typ', 'Rolle']],
      body: steps.map((s, i) => [i + 1, s.name || '—', s.typeLabel, s.lane || '—']),
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 1.5 },
      headStyles: { fillColor: [240, 240, 240], textColor: 80, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 12, halign: 'right' },
        2: { cellWidth: 35 },
        3: { cellWidth: 40 }
      },
      margin: { left: margin, right: margin }
    });
  }

  drawPdfFooter(doc, c, ctx);
}

function drawPdfFooter(doc, c, ctx) {
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFontSize(8).setFont('helvetica', 'normal').setTextColor(120);
  doc.text(c.name, 20, pageH - 12);
  const stamp = `Stand: ${new Date().toLocaleDateString('de-DE')}`;
  doc.text(stamp, (pageW - doc.getTextWidth(stamp)) / 2, pageH - 12);
  const pg = `Seite ${ctx.idx} von ${ctx.total}`;
  doc.text(pg, pageW - 20 - doc.getTextWidth(pg), pageH - 12);
}

// ─── BPMN downloads ─────────────────────────────────────────────────
async function downloadProcessBpmn(group) {
  if (!group.bpmn) return;
  try {
    const res = await fetch(encodeURI(group.bpmn));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    downloadBlob(new Blob([xml], { type: 'application/xml' }), `${sanitizeFilename(group.id)}.bpmn`);
  } catch (err) {
    alert(`Download fehlgeschlagen: ${err.message}`);
  }
}

function downloadCollectionBpmnZip(c, filtered) {
  return withBusy('ZIP wird erstellt…', async () => {
    const zip = new window.JSZip();
    const tasks = [];
    filtered.forEach(a => a.groups.forEach(g => {
      if (!g.bpmn) return;
      tasks.push(fetch(encodeURI(g.bpmn))
        .then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then(xml => zip.file(`${sanitizeFilename(g.id)}.bpmn`, xml))
        .catch(err => console.warn(`Skip ${g.id}:`, err.message)));
    }));
    await Promise.all(tasks);
    const blob = await zip.generateAsync({ type: 'blob' });
    downloadBlob(blob, `${sanitizeFilename(c.id)}-bpmn.zip`);
  });
}

// ─── Export helpers ─────────────────────────────────────────────────
async function fetchAndParseSteps(path) {
  const res = await fetch(encodeURI(path));
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseBpmnSteps(await res.text());
}

function sanitizeFilename(s) {
  return String(s).replace(/[^\w.\-]+/g, '_');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function withBusy(text, fn) {
  const overlay = document.createElement('div');
  overlay.className = 'busy-overlay';
  overlay.innerHTML = `<div class="loading-spinner"></div><p>${escapeHtml(text)}</p>`;
  document.body.appendChild(overlay);
  return Promise.resolve().then(fn).catch(err => {
    console.error('Export failed:', err);
    alert(`Export fehlgeschlagen: ${err.message}`);
  }).finally(() => overlay.remove());
}

// ─── Process / BPMN viewer ──────────────────────────────────────────
function renderProcess(collId, processId, detailTab) {
  const c = state.collections.find(x => x.id === collId);
  if (!c) {
    document.getElementById('main-content').innerHTML =
      `<div class="content-wrapper"><p>Sammlung nicht gefunden.</p></div>`;
    return;
  }
  const found = findGroupInCollection(c, processId);
  if (!found) {
    document.getElementById('main-content').innerHTML =
      `<div class="content-wrapper"><p>Prozess nicht gefunden.</p></div>`;
    return;
  }
  const { area, group } = found;
  const tab = ['diagram', 'metadata', 'steps'].includes(detailTab) ? detailTab : 'diagram';
  const processBase = `#/c/${encodeURIComponent(c.id)}/process/${encodeURIComponent(group.id)}`;

  addRecent({ title: `${c.name} · ${group.id} ${group.name}`, hash: processBase });

  document.getElementById('main-content').innerHTML = `
    <div class="content-wrapper process-view">
      ${renderBreadcrumb([
        { label: 'Home', hash: '#/' },
        { label: c.name, hash: `#/c/${encodeURIComponent(c.id)}` },
        { label: `${group.id} ${group.name}` }
      ])}

      <div class="title-block">
        <div class="title-block-icon">
          <i data-lucide="file-text" style="width:20px;height:20px;"></i>
        </div>
        <div class="title-block-content">
          <h1 class="title-block-name">${escapeHtml(group.name)}</h1>
          <div class="title-block-subtitle">${escapeHtml(c.name)} · ${escapeHtml(area.name)} · ${escapeHtml(group.id)}</div>
        </div>
      </div>

      <div class="tab-bar" role="tablist">
        <div class="tab-bar-scroll">
          <button class="tab ${tab === 'diagram' ? 'active' : ''}" data-nav="${processBase}" role="tab" aria-selected="${tab === 'diagram'}">Diagramm</button>
          <button class="tab ${tab === 'steps' ? 'active' : ''}" data-nav="${processBase}/steps" role="tab" aria-selected="${tab === 'steps'}">Schritte</button>
          <button class="tab ${tab === 'metadata' ? 'active' : ''}" data-nav="${processBase}/metadata" role="tab" aria-selected="${tab === 'metadata'}">Metadaten</button>
        </div>
        ${renderExportDropdown('process', { c, area, group })}
      </div>

      <div id="process-tab-content">
        ${tab === 'diagram'  ? renderProcessDiagramPane(group) :
          tab === 'metadata' ? renderProcessMetadataPane(c, area, group) :
                                renderProcessStepsPane()}
      </div>
    </div>
  `;

  if (tab === 'diagram') {
    if (!group.bpmn) {
      // Empty viewer — leave the canvas blank; the toolbar overlay stays.
      document.getElementById('bpmn-canvas').innerHTML = '';
      return;
    }
    loadBpmn(group.bpmn);
  } else if (tab === 'steps') {
    loadProcessSteps(group);
  }
}

function renderProcessDiagramPane(group) {
  return `
    <div class="bpmn-container" id="bpmn-container">
      <div class="bpmn-canvas" id="bpmn-canvas">
        <div class="bpmn-loading">
          <div class="loading-spinner"></div>
          <p>Diagramm wird geladen…</p>
        </div>
      </div>
      <div class="bpmn-toolbar" role="toolbar" aria-label="Diagramm-Werkzeuge">
        <button class="tool-btn" id="bpmn-zoom-fit" type="button" aria-label="Anpassen" title="Anpassen">
          <i data-lucide="maximize" style="width:14px;height:14px;"></i>
        </button>
        <button class="tool-btn" id="bpmn-zoom-reset" type="button" aria-label="100%" title="Auf 100% zurücksetzen">
          <i data-lucide="square" style="width:14px;height:14px;"></i>
        </button>
        <button class="tool-btn" id="bpmn-zoom-in" type="button" aria-label="Vergrößern" title="Vergrößern">
          <i data-lucide="zoom-in" style="width:14px;height:14px;"></i>
        </button>
        <button class="tool-btn" id="bpmn-zoom-out" type="button" aria-label="Verkleinern" title="Verkleinern">
          <i data-lucide="zoom-out" style="width:14px;height:14px;"></i>
        </button>
        <div class="bpmn-toolbar-sep"></div>
        <button class="tool-btn" id="bpmn-fullscreen" type="button" aria-label="Vollbild" title="Vollbild">
          <i data-lucide="expand" style="width:14px;height:14px;"></i>
        </button>
      </div>
    </div>
  `;
}

function renderProcessMetadataPane(c, area, group) {
  const dash = '<span style="color: var(--color-text-placeholder);">—</span>';
  const emptyPara = msg => `<p style="margin:0; color: var(--color-text-placeholder);">${escapeHtml(msg)}</p>`;

  const responsibleList = (group.responsible || []).map(renderPersonInline).join('<br>') || dash;
  const tagsHtml = (group.tags || []).length
    ? (group.tags || []).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join(' ')
    : dash;

  const outputs   = group.outputs   || [];
  const systems   = group.systems   || [];
  const standards = group.standards || [];
  const documents = group.documents || [];
  const linkedProcs = group.linkedProcesses || { predecessor: [], successor: [], related: [] };
  const linkedTotal = (linkedProcs.predecessor?.length || 0)
                    + (linkedProcs.successor?.length   || 0)
                    + (linkedProcs.related?.length     || 0);

  const propsTable = rows => `
    <table class="props-table">
      <tbody>
        ${rows.map(row => `
          <tr>
            <th scope="row">${escapeHtml(row.label)}</th>
            <td>${row.value}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;

  return `
    <section class="content-section">
      <div class="section-label">Zweck & Kontext</div>
      ${propsTable([
        { label: 'Beschreibung', value: group.description ? escapeHtml(group.description) : dash },
        { label: 'Zweck',        value: group.purpose     ? escapeHtml(group.purpose)     : dash },
        { label: 'Trigger',      value: group.trigger     ? escapeHtml(group.trigger)     : dash },
        { label: 'Ergebnisse',   value: outputs.length
            ? `<ul class="bullet-list" style="margin:0;">${outputs.map(o => `<li>${escapeHtml(o)}</li>`).join('')}</ul>`
            : dash }
      ])}
    </section>

    <section class="content-section">
      <div class="section-label">Prozessverantwortliche</div>
      ${propsTable([
        { label: 'Owner',                 value: renderPersonInline(group.owner) },
        { label: 'Responsible',           value: responsibleList },
        { label: 'Subject-Matter Expert', value: renderPersonInline(group.expert) }
      ])}
    </section>

    <section class="content-section">
      <div class="section-label">Einordnung & Status</div>
      ${propsTable([
        { label: 'Sammlung',       value: escapeHtml(c.name) },
        { label: 'Bereich',        value: escapeHtml(area.name) },
        { label: 'Klassifikation', value: group.classification ? escapeHtml(group.classification) : dash },
        { label: 'Tags',           value: tagsHtml },
        { label: 'Status',         value: renderStatusBadge(group.status) },
        { label: 'Version',        value: group.version    ? escapeHtml(group.version)    : dash },
        { label: 'Gültig ab',      value: group.validFrom  ? escapeHtml(group.validFrom)  : dash },
        { label: 'Gültig bis',     value: group.validUntil ? escapeHtml(group.validUntil) : dash },
        { label: 'Aktualisiert',   value: group.updatedAt  ? escapeHtml(group.updatedAt)  : dash },
        { label: 'Review-Zyklus',  value: group.reviewCycleMonths ? `${group.reviewCycleMonths} Monate` : dash }
      ])}
    </section>

    <section class="content-section">
      <div class="section-label">Unterstützende Systeme</div>
      ${systems.length
        ? `<div style="display: flex; flex-wrap: wrap; gap: var(--space-2);">${
            systems.map(s => `<span class="tag-chip">${escapeHtml(s)}</span>`).join('')
          }</div>`
        : emptyPara('Keine Systeme erfasst.')}
    </section>

    <section class="content-section">
      <div class="section-label">Grundlagen & Standards</div>
      ${standards.length
        ? `<ul class="bullet-list">${standards.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`
        : emptyPara('Keine Grundlagen erfasst.')}
    </section>

    <section class="content-section">
      <div class="section-label">Dokumente</div>
      ${documents.length
        ? `<ul class="bullet-list">${documents.map(d => `<li>${
            d.url
              ? `<a href="${escapeAttr(d.url)}" target="_blank" rel="noopener">${escapeHtml(d.label || d.url)}</a>`
              : escapeHtml(d.label || '')
          }</li>`).join('')}</ul>`
        : emptyPara('Keine Dokumente verknüpft.')}
    </section>

    <section class="content-section">
      <div class="section-label">Beziehungen zu anderen Prozessen</div>
      ${linkedTotal === 0
        ? emptyPara('Keine Verknüpfungen erfasst.')
        : propsTable([
            { label: 'Vorgänger',  value: renderLinkedProcesses(c, linkedProcs.predecessor) },
            { label: 'Nachfolger', value: renderLinkedProcesses(c, linkedProcs.successor)   },
            { label: 'Verwandt',   value: renderLinkedProcesses(c, linkedProcs.related)     }
          ])}
    </section>
  `;
}

function renderLinkedProcesses(c, ids) {
  if (!ids || ids.length === 0) return '<span style="color: var(--color-text-placeholder);">—</span>';
  return ids.map(pid => {
    const hit = findGroupInCollection(c, pid);
    if (hit) {
      const href = processHrefFor(c.id, pid);
      return `<a href="${escapeAttr(href)}">${escapeHtml(pid)} ${escapeHtml(hit.group.name)}</a>`;
    }
    return escapeHtml(pid);
  }).join('<br>');
}

function renderProcessStepsPane() {
  return `
    <div class="list-panel">
      <div id="process-steps">
        <div class="bpmn-loading">
          <div class="loading-spinner"></div>
          <p>Schritte werden geladen…</p>
        </div>
      </div>
    </div>
  `;
}

function renderPersonInline(id) {
  if (!id) return '<span style="color: var(--color-text-placeholder);">—</span>';
  const p = resolvePerson(id);
  if (!p) return escapeHtml(id);
  return `<div>${escapeHtml(p.name)}</div>${p.org ? `<div style="font-size: var(--text-small); color: var(--color-text-secondary);">${escapeHtml(p.org)}</div>` : ''}`;
}

async function loadProcessSteps(group) {
  const container = document.getElementById('process-steps');
  if (!container) return;
  if (!group.bpmn) {
    container.innerHTML = `<div class="empty-state">Keine Schritte verfügbar — BPMN-Datei fehlt.</div>`;
    return;
  }
  try {
    const res = await fetch(encodeURI(group.bpmn));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const steps = parseBpmnSteps(xml);
    container.innerHTML = renderStepsTable(steps);
  } catch (err) {
    container.innerHTML = `<div class="bpmn-empty"><small>Schritte konnten nicht geladen werden: ${escapeHtml(err.message)}</small></div>`;
  }
}

const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';

const STEP_TYPES = [
  { tag: 'startEvent',              label: 'Start',          kind: 'event' },
  { tag: 'endEvent',                label: 'Ende',           kind: 'event' },
  { tag: 'intermediateCatchEvent',  label: 'Zwischenereignis', kind: 'event' },
  { tag: 'intermediateThrowEvent',  label: 'Zwischenereignis', kind: 'event' },
  { tag: 'boundaryEvent',           label: 'Randereignis',   kind: 'event' },
  { tag: 'task',                    label: 'Aufgabe',        kind: 'task' },
  { tag: 'userTask',                label: 'Benutzer-Aufgabe', kind: 'task' },
  { tag: 'serviceTask',             label: 'Service-Aufgabe', kind: 'task' },
  { tag: 'manualTask',              label: 'Manuelle Aufgabe', kind: 'task' },
  { tag: 'scriptTask',              label: 'Skript-Aufgabe', kind: 'task' },
  { tag: 'sendTask',                label: 'Sende-Aufgabe',  kind: 'task' },
  { tag: 'receiveTask',             label: 'Empfangs-Aufgabe', kind: 'task' },
  { tag: 'businessRuleTask',        label: 'Regel-Aufgabe',  kind: 'task' },
  { tag: 'callActivity',            label: 'Call Activity',  kind: 'task' },
  { tag: 'subProcess',              label: 'Teilprozess',    kind: 'subprocess' },
  { tag: 'exclusiveGateway',        label: 'XOR-Gateway',    kind: 'gateway' },
  { tag: 'parallelGateway',         label: 'AND-Gateway',    kind: 'gateway' },
  { tag: 'inclusiveGateway',        label: 'OR-Gateway',     kind: 'gateway' },
  { tag: 'eventBasedGateway',       label: 'Ereignis-Gateway', kind: 'gateway' },
  { tag: 'complexGateway',          label: 'Komplex-Gateway', kind: 'gateway' }
];

function parseBpmnSteps(xmlString) {
  const doc = new DOMParser().parseFromString(xmlString, 'application/xml');

  // Build nodeId → laneName map
  const laneMap = new Map();
  for (const lane of doc.getElementsByTagNameNS(BPMN_NS, 'lane')) {
    const laneName = lane.getAttribute('name') || '';
    for (const ref of lane.getElementsByTagNameNS(BPMN_NS, 'flowNodeRef')) {
      laneMap.set(ref.textContent.trim(), laneName);
    }
  }

  // Collect all typed flow elements, then sort by document position
  const typeByTag = new Map(STEP_TYPES.map(t => [t.tag, t]));
  const collected = [];
  for (const t of STEP_TYPES) {
    for (const n of doc.getElementsByTagNameNS(BPMN_NS, t.tag)) {
      collected.push(n);
    }
  }
  collected.sort((a, b) => {
    const rel = a.compareDocumentPosition(b);
    if (rel & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (rel & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  return collected.map(n => {
    const meta = typeByTag.get(n.localName);
    return {
      id: n.getAttribute('id') || '',
      name: n.getAttribute('name') || '',
      typeLabel: meta?.label || n.localName,
      kind: meta?.kind || 'other',
      lane: laneMap.get(n.getAttribute('id')) || ''
    };
  });
}

function renderStepsTable(steps) {
  if (steps.length === 0) {
    return `<div class="empty-state">Keine Schritte im BPMN-Modell gefunden.</div>`;
  }
  return `
    <div class="data-table-wrap">
      <table class="data-table">
        <colgroup>
          <col style="width: 56px;">
          <col>
          <col style="width: 180px;">
          <col style="width: 220px;">
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Nr.</th>
            <th scope="col">Name</th>
            <th scope="col">Typ</th>
            <th scope="col">Rolle</th>
          </tr>
        </thead>
        <tbody>
          ${steps.map((s, i) => `
            <tr>
              <td style="font-variant-numeric: tabular-nums; color: var(--color-text-secondary);">${i + 1}</td>
              <td>${s.name ? escapeHtml(s.name) : '<span style="color: var(--color-text-placeholder);">(ohne Namen)</span>'}</td>
              <td>${escapeHtml(s.typeLabel)}</td>
              <td>${s.lane ? escapeHtml(s.lane) : '<span style="color: var(--color-text-placeholder);">—</span>'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

async function loadBpmn(path) {
  const canvasEl = document.getElementById('bpmn-canvas');
  try {
    const res = await fetch(encodeURI(path));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    canvasEl.innerHTML = '';
    if (!window.BpmnJS) throw new Error('BPMN-Viewer nicht geladen');
    // NavigatedViewer enables mouse pan + wheel zoom out of the box.
    state.bpmnViewer = new window.BpmnJS({ container: canvasEl });
    const { warnings } = await state.bpmnViewer.importXML(xml);
    if (warnings?.length) console.warn('BPMN import warnings:', warnings);
    state.bpmnViewer.get('canvas').zoom('fit-viewport', 'auto');
    wireBpmnToolbar();
  } catch (err) {
    canvasEl.innerHTML = `<div class="bpmn-empty">
      <strong>Diagramm konnte nicht geladen werden.</strong><br>
      <small>${escapeHtml(err.message)}</small><br>
      <small>Pfad: <code>${escapeHtml(path)}</code></small>
    </div>`;
  }
}

function wireBpmnToolbar() {
  const canvas = state.bpmnViewer.get('canvas');
  const container = document.getElementById('bpmn-container');
  const canvasEl = document.getElementById('bpmn-canvas');
  document.getElementById('bpmn-zoom-fit')?.addEventListener('click', () => canvas.zoom('fit-viewport', 'auto'));
  document.getElementById('bpmn-zoom-reset')?.addEventListener('click', () => canvas.zoom(1.0, 'auto'));
  document.getElementById('bpmn-zoom-in')?.addEventListener('click', () => canvas.zoom(canvas.zoom() * 1.2));
  document.getElementById('bpmn-zoom-out')?.addEventListener('click', () => canvas.zoom(canvas.zoom() / 1.2));

  document.getElementById('bpmn-fullscreen')?.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      container?.requestFullscreen?.().catch(err => console.warn('Fullscreen denied:', err));
    } else {
      document.exitFullscreen?.();
    }
  });
  document.addEventListener('fullscreenchange', onFullscreenChange);

  // Disable bpmn-js built-in scroll-to-pan and replace with scroll-to-zoom.
  // The default in NavigatedViewer is: plain wheel pans, Ctrl+wheel zooms —
  // we invert that so the wheel always zooms, cursor-anchored.
  try { state.bpmnViewer.get('zoomScroll').toggle(false); } catch { /* module missing */ }
  if (canvasEl && !canvasEl._zoomHandlerAttached) {
    canvasEl.addEventListener('wheel', onBpmnWheel, { passive: false });
    canvasEl._zoomHandlerAttached = true;
  }
}

function onBpmnWheel(e) {
  if (!state.bpmnViewer) return;
  e.preventDefault();
  const canvas = state.bpmnViewer.get('canvas');
  // deltaY > 0 means scrolling away from user → zoom out. Step scales with
  // intensity for trackpad smoothness but clamps so one notch of a mouse
  // wheel gives a sane 10% change.
  const stepRaw = -e.deltaY / 120;
  const step = Math.max(-1, Math.min(1, stepRaw));
  const factor = Math.pow(1.1, step);
  // Zoom around the cursor position, not the canvas center.
  const rect = e.currentTarget.getBoundingClientRect();
  const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  canvas.zoom(canvas.zoom() * factor, point);
}

function onFullscreenChange() {
  const container = document.getElementById('bpmn-container');
  if (!container) return;
  const isFs = document.fullscreenElement === container;
  container.classList.toggle('is-fullscreen', isFs);
  try { state.bpmnViewer?.get('canvas').zoom('fit-viewport', 'auto'); } catch { /* viewer gone */ }
}

// ─── Chat / Workflows views ─────────────────────────────────────────
function renderChatView() {
  return `<div class="content-wrapper">
    ${renderBreadcrumb([{ label: 'Home', hash: '#/' }, { label: 'KI-Assistent' }])}

    <div class="title-block">
      <div class="title-block-icon">
        <i data-lucide="sparkles" style="width:20px;height:20px;"></i>
      </div>
      <div class="title-block-content">
        <h1 class="title-block-name">KI-Assistent</h1>
        <div class="title-block-subtitle">Stellen Sie Fragen zur Prozesslandschaft. Diese Funktion ist ein Platzhalter.</div>
      </div>
    </div>

    <div class="chat-placeholder">
      <div class="chat-placeholder-body">
        <i data-lucide="message-square-text" style="width:56px;height:56px;"></i>
        <h3 class="chat-placeholder-title">Chat-Funktion noch nicht verfügbar</h3>
        <p class="chat-placeholder-description">In einer zukünftigen Version können Sie hier mit einem KI-Assistenten über die Inhalte des Process Hub sprechen. Der Assistent wird Prozesse erklären, Zusammenhänge zwischen Schritten und Rollen aufzeigen und Sie bei der Navigation durch die Sammlungen unterstützen.</p>
      </div>
      <div class="chat-placeholder-input">
        <input type="text" disabled placeholder="Stellen Sie eine Frage zum Prozessmodell…">
        <button class="btn btn-primary" disabled>Senden</button>
      </div>
    </div>
  </div>`;
}

function renderWorkflowsView() {
  return `<div class="content-wrapper">
    ${renderBreadcrumb([{ label: 'Home', hash: '#/' }, { label: 'Workflows & API' }])}

    <div class="title-block">
      <div class="title-block-icon">
        <i data-lucide="workflow" style="width:20px;height:20px;"></i>
      </div>
      <div class="title-block-content">
        <h1 class="title-block-name">Workflows & API</h1>
        <div class="title-block-subtitle">Exporte und Integrationen für alle Prozess-Sammlungen.</div>
      </div>
    </div>

    <section class="content-section">
      <div class="section-label">Export</div>
      <div class="data-table-wrap">
        <table class="data-table">
          <colgroup>
            <col>
            <col style="width: 110px;">
            <col style="width: 140px;">
            <col style="width: 420px;">
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Sammlung</th>
              <th scope="col">Prozesse</th>
              <th scope="col">Mit Diagramm</th>
              <th scope="col">Downloads</th>
            </tr>
          </thead>
          <tbody>
            ${state.collections.map(c => {
              const total = totalProcesses(c.landscape);
              const withBpmn = processesWithBpmn(c.landscape);
              const hasBpmn = withBpmn > 0;
              return `
                <tr>
                  <td>
                    <a href="#/c/${encodeURIComponent(c.id)}">${escapeHtml(c.name)}</a>
                    ${c.subtitle ? `<div>${escapeHtml(c.subtitle)}</div>` : ''}
                  </td>
                  <td style="font-variant-numeric: tabular-nums;">${total}</td>
                  <td style="font-variant-numeric: tabular-nums;">${withBpmn}</td>
                  <td>
                    <div style="display:flex; flex-wrap: wrap; gap: var(--space-2);">
                      <button class="tool-btn" type="button" data-export-coll="${escapeAttr(c.id)}:excel">
                        <i data-lucide="file-spreadsheet" style="width:14px;height:14px;"></i> Als Excel
                      </button>
                      <button class="tool-btn" type="button" data-export-coll="${escapeAttr(c.id)}:pdf">
                        <i data-lucide="file-text" style="width:14px;height:14px;"></i> Als PDF
                      </button>
                      <button class="tool-btn" type="button" data-export-coll="${escapeAttr(c.id)}:bpmn" ${hasBpmn ? '' : 'disabled'}>
                        <i data-lucide="archive" style="width:14px;height:14px;"></i> BPMN als ZIP
                      </button>
                    </div>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </section>

    <section class="content-section">
      <div class="section-label">REST API</div>
      <p style="color:var(--color-text-secondary); margin-bottom: var(--space-4);">
        Programmatischer Zugriff auf Sammlungen, Prozesse und Schritte. Eine OpenAPI-Spezifikation ist in Vorbereitung.
      </p>
      <button type="button" class="tool-btn" disabled title="Noch nicht verfügbar">
        <i data-lucide="book-open" style="width:14px;height:14px;"></i> API-Dokumentation (bald)
      </button>
    </section>
  </div>`;
}

// ─── Search ─────────────────────────────────────────────────────────
//
// Searches across all loaded collections. Two entity types:
//   - Sammlungen: match on name / subtitle / description
//   - Prozesse:   match on id / name / description / purpose / tags
// Returns sorted results capped at `limit` per group.
function searchHub(q, limit) {
  const needle = (q || '').trim().toLowerCase();
  if (!needle) return { collections: [], processes: [] };

  const matches = (hay) => (hay || '').toLowerCase().includes(needle);

  const collections = state.collections
    .filter(c => matches(c.name) || matches(c.subtitle) || matches(c.description))
    .slice(0, limit);

  const processes = [];
  outer:
  for (const c of state.collections) {
    for (const a of c.landscape.areas) {
      for (const g of a.groups) {
        const hitTags = (g.tags || []).some(t => matches(t));
        if (matches(g.id) || matches(g.name) || matches(g.description) || matches(g.purpose) || hitTags) {
          processes.push({ c, a, g });
          if (processes.length >= limit) break outer;
        }
      }
    }
  }

  return { collections, processes };
}

function syncHeaderSearch(q) {
  const input = document.getElementById('search-input');
  if (input && input.value !== q) input.value = q;
  const clearBtn = document.getElementById('search-clear');
  if (clearBtn) clearBtn.hidden = !q.length;
}

function hideSearchDropdown() {
  const dd = document.getElementById('search-dropdown');
  if (dd && !dd.hidden) {
    dd.hidden = true;
    dd.innerHTML = '';
  }
}

function renderSearchDropdown(q) {
  const dd = document.getElementById('search-dropdown');
  if (!dd) return;

  const trimmed = (q || '').trim();
  const ctaSubtitle = trimmed
    ? `„${escapeHtml(trimmed)}" an den KI-Assistenten senden`
    : 'Fragen Sie den KI-Assistenten zur Prozesslandschaft';

  let html = `<div class="search-dropdown-cta" data-href="#/chat" role="option">
    <div class="search-dropdown-cta-icon"><i data-lucide="sparkles" style="width:16px;height:16px;"></i></div>
    <div>
      <div class="search-dropdown-cta-title">KI-Assistent fragen</div>
      <div class="search-dropdown-cta-subtitle">${ctaSubtitle}</div>
    </div>
  </div>`;

  if (trimmed) {
    const { collections, processes } = searchHub(trimmed, 5);
    const total = collections.length + processes.length;

    if (total === 0) {
      html += `<div class="search-dropdown-empty">Keine Treffer für „${escapeHtml(trimmed)}".</div>`;
    } else {
      if (collections.length) {
        html += `<div class="search-dropdown-group">
          <div class="search-dropdown-group-label">Sammlungen</div>
          ${collections.map(c => `
            <div class="search-dropdown-item" data-href="${collectionHrefFor(c.id)}" role="option">
              <div class="search-dropdown-item-icon"><i data-lucide="folder-tree" style="width:16px;height:16px;"></i></div>
              <div>
                <div class="search-dropdown-item-name">${escapeHtml(c.name)}</div>
                <div class="search-dropdown-item-meta">${escapeHtml(c.subtitle || 'Sammlung')}</div>
              </div>
            </div>`).join('')}
        </div>`;
      }
      if (processes.length) {
        html += `<div class="search-dropdown-group">
          <div class="search-dropdown-group-label">Prozesse</div>
          ${processes.map(({ c, a, g }) => `
            <div class="search-dropdown-item" data-href="${processHrefFor(c.id, g.id)}" role="option">
              <div class="search-dropdown-item-icon"><i data-lucide="file-text" style="width:16px;height:16px;"></i></div>
              <div>
                <div class="search-dropdown-item-name">${escapeHtml(g.name)}</div>
                <div class="search-dropdown-item-meta">${escapeHtml(g.id)} · ${escapeHtml(c.name)} · ${escapeHtml(a.name)}</div>
              </div>
            </div>`).join('')}
        </div>`;
      }
    }
    html += `<div class="search-dropdown-footer"><kbd>Enter</kbd> für alle Ergebnisse</div>`;
  }

  dd.innerHTML = html;
  dd.hidden = false;
  if (window.lucide?.createIcons) window.lucide.createIcons({ nodes: [dd] });
}

function setSearchDropdownActive(items, idx) {
  items.forEach((el, i) => {
    const active = i === idx;
    el.setAttribute('aria-selected', String(active));
    el.classList.toggle('search-dropdown-item-active', active);
  });
  items[idx]?.scrollIntoView({ block: 'nearest' });
}

function renderSearchResults(q) {
  const trimmed = (q || '').trim();
  if (!trimmed) {
    return `<div class="content-wrapper">
      ${renderBreadcrumb([{ label: 'Home', hash: '#/' }, { label: 'Suche' }])}
      <div class="title-block">
        <div class="title-block-icon"><i data-lucide="search" style="width:20px;height:20px;"></i></div>
        <div class="title-block-content">
          <h1 class="title-block-name">Suche</h1>
          <div class="title-block-subtitle">Sammlungen und Prozesse durchsuchen.</div>
        </div>
      </div>
      <p style="color: var(--color-text-secondary);">Geben Sie oben einen Suchbegriff ein.</p>
    </div>`;
  }

  const { collections, processes } = searchHub(trimmed, 100);
  const total = collections.length + processes.length;
  const noun = total === 1 ? 'Treffer' : 'Treffer';

  let body = '';
  if (total === 0) {
    body = `<div class="list-panel" style="text-align:center; padding: var(--space-8);">
      <i data-lucide="search-x" style="width:40px;height:40px; color: var(--color-text-placeholder);"></i>
      <h3 style="margin-top: var(--space-3);">Keine Treffer</h3>
      <p style="color: var(--color-text-secondary);">Keine Sammlungen oder Prozesse passen zu „${escapeHtml(trimmed)}".</p>
    </div>`;
  } else {
    body = '<div class="list-panel">';
    if (collections.length) {
      body += `<div class="search-group-label">Sammlungen <span style="color:var(--color-text-placeholder);font-weight:500;margin-left:4px;">${collections.length}</span></div>`;
      for (const c of collections) {
        body += `<div class="search-result-item" data-href="${collectionHrefFor(c.id)}">
          <div class="search-result-icon"><i data-lucide="folder-tree" style="width:16px;height:16px;"></i></div>
          <div>
            <div class="search-result-name">${escapeHtml(c.name)}</div>
            <div class="search-result-type">${escapeHtml(c.subtitle || 'Sammlung')}</div>
          </div>
        </div>`;
      }
    }
    if (processes.length) {
      body += `<div class="search-group-label">Prozesse <span style="color:var(--color-text-placeholder);font-weight:500;margin-left:4px;">${processes.length}</span></div>`;
      for (const { c, a, g } of processes) {
        body += `<div class="search-result-item" data-href="${processHrefFor(c.id, g.id)}">
          <div class="search-result-icon"><i data-lucide="file-text" style="width:16px;height:16px;"></i></div>
          <div>
            <div class="search-result-name">${escapeHtml(g.name)}</div>
            <div class="search-result-type">${escapeHtml(g.id)} · ${escapeHtml(c.name)} · ${escapeHtml(a.name)} ${renderStatusBadge(g.status)}</div>
          </div>
        </div>`;
      }
    }
    body += '</div>';
  }

  return `<div class="content-wrapper">
    ${renderBreadcrumb([{ label: 'Home', hash: '#/' }, { label: 'Suche' }])}
    <div class="title-block">
      <div class="title-block-icon"><i data-lucide="search" style="width:20px;height:20px;"></i></div>
      <div class="title-block-content">
        <h1 class="title-block-name">Suchergebnisse</h1>
        <div class="title-block-subtitle">${total} ${noun} für „${escapeHtml(trimmed)}"</div>
      </div>
    </div>
    ${body}
  </div>`;
}

function renderRecents() {
  if (state.recents.length === 0) {
    return `<div class="content-wrapper">
      ${renderBreadcrumb([{ label: 'Home', hash: '#/' }, { label: 'Zuletzt angesehen' }])}
      <h1 class="title-block-name" style="margin-bottom: var(--space-4);">Zuletzt angesehen</h1>
      <p style="color: var(--color-text-secondary);">Noch keine Prozesse geöffnet.</p>
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
