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

const RECENTS_KEY = 'processHub.recents';
const SIDEBAR_KEY = 'processHub.sidebarCollapsed';

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
  if (localStorage.getItem(SIDEBAR_KEY) === '1') {
    document.body.classList.add('sidebar-collapsed');
  }
}

function persistRecents() {
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(state.recents)); } catch { /* ignore */ }
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
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'home' };
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
    const view = parts[2] === 'diagram' ? 'diagram' : 'table';
    return { name: 'collection', collId, view };
  }
  return { name: 'home' };
}

function handleRoute() {
  state.route = parseRoute();
  state.filterPanelOpen = false;
  const keepViewer = state.route.name === 'process' && state.route.detailTab === 'diagram';
  if (state.bpmnViewer && !keepViewer) {
    state.bpmnViewer.destroy();
    state.bpmnViewer = null;
  }

  renderSidebar();
  const main = document.getElementById('main-content');
  switch (state.route.name) {
    case 'home':       main.innerHTML = renderHome(); break;
    case 'chat':       main.innerHTML = renderPlaceholder('KI-Assistent', 'Chat-Oberfläche für Fragen zur Prozesslandschaft (Platzhalter).'); break;
    case 'workflows':  main.innerHTML = renderPlaceholder('Workflows & API', 'API-Dokumentation und Workflow-Definitionen (Platzhalter).'); break;
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
  document.addEventListener('click', e => {
    if (e.target.closest('#sidebar-toggle')) {
      document.body.classList.toggle('sidebar-collapsed');
      localStorage.setItem(SIDEBAR_KEY,
        document.body.classList.contains('sidebar-collapsed') ? '1' : '0');
      renderSidebar(); lucide.createIcons();
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
    <button type="button" class="sidebar-toggle" id="sidebar-toggle"
      aria-label="${collapsed ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'}"
      aria-expanded="${!collapsed}">
      <i data-lucide="chevron-left" style="width:16px;height:16px;"></i>
    </button>

    ${navItem('home', 'Home', r.name === 'home', '#/')}
    ${navItem('sparkles', 'KI-Assistent', r.name === 'chat', '#/chat')}
    ${navItem('workflow', 'Workflows & API', r.name === 'workflows', '#/workflows')}

    <div class="nav-divider sidebar-collapsed-hide"></div>
    <div class="nav-section-label">Prozess-Sammlungen</div>
  `;

  for (const c of state.collections) {
    const active = (r.name === 'collection' || r.name === 'process') && r.collId === c.id;
    const count = totalProcesses(c.landscape);
    html += `
      <div class="nav-item ${active ? 'active' : ''}" data-nav="#/c/${encodeURIComponent(c.id)}"
           role="link" title="${escapeAttr(c.name)}">
        <i data-lucide="folder-tree" style="width:16px;height:16px;flex-shrink:0;"></i>
        <span>${escapeHtml(c.name)}</span>
        <span class="nav-count">${count}</span>
      </div>`;
  }

  if (state.recents.length > 0) {
    html += '<div class="nav-divider sidebar-collapsed-hide"></div>';
    html += '<div class="nav-section-label">Zuletzt angesehen</div>';
    state.recents.slice(0, 5).forEach(rec => {
      html += `<div class="nav-recent-item" data-nav="${escapeAttr(rec.hash)}" title="${escapeAttr(rec.title)}">${escapeHtml(rec.title)}</div>`;
    });
  }

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
                <th scope="col" style="text-align:right;">Bereiche</th>
                <th scope="col" style="text-align:right;">Prozesse</th>
                <th scope="col" style="text-align:right;">Mit Diagramm</th>
                <th scope="col">Aktualisiert</th>
              </tr>
            </thead>
            <tbody>
              ${state.collections.map(renderCollectionRow).join('')}
            </tbody>
          </table>
        </div>
      </div>

      ${state.recents.length > 0 ? `
        <div class="section-label" style="margin-top: var(--space-6);">Zuletzt angesehen</div>
        <ul class="recents-list">
          ${state.recents.map(r => `
            <li><a href="${escapeAttr(r.hash)}" class="recents-list-item">
              <i data-lucide="file-text" style="width:16px;height:16px;"></i>
              <span>${escapeHtml(r.title)}</span>
            </a></li>`).join('')}
        </ul>
      ` : ''}
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
      <td style="text-align:right; font-variant-numeric: tabular-nums;">${c.landscape.areas.length}</td>
      <td style="text-align:right; font-variant-numeric: tabular-nums;">${count}</td>
      <td style="text-align:right; font-variant-numeric: tabular-nums;">${bpmn}</td>
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

      ${c.description ? `<p class="collection-description">${escapeHtml(c.description)}</p>` : ''}
      ${c.owner ? `<p class="collection-meta">
        <span class="detail-label-inline">Quelle:</span>
        ${c.ownerUrl
          ? `<a href="${escapeAttr(c.ownerUrl)}" target="_blank" rel="noopener">${escapeHtml(c.owner)}</a>`
          : escapeHtml(c.owner)}
      </p>` : ''}

      <div class="tab-bar" role="tablist">
        <div class="tab-bar-scroll">
          <button class="tab ${view === 'table' ? 'active' : ''}" data-nav="#/c/${encodeURIComponent(c.id)}/table" role="tab" aria-selected="${view === 'table'}">Tabelle</button>
          <button class="tab ${view === 'diagram' ? 'active' : ''}" data-nav="#/c/${encodeURIComponent(c.id)}/diagram" role="tab" aria-selected="${view === 'diagram'}">Diagramm</button>
        </div>
        ${f.toggleHtml}
        ${view === 'table' ? renderGroupingDropdown(c.id) : ''}
        ${renderExportDropdown('collection', f.filtered)}
      </div>

      ${f.pillsHtml}
      ${f.panelHtml}

      ${view === 'diagram' ? renderDiagramView(c, f.filtered) : renderTableView(c, f.filtered)}
    </div>
  `;
}

function buildFilterContext(c, filters) {
  const filtered = c.landscape.areas.map(a => ({
    ...a,
    groups: a.groups.filter(g => {
      if (filters.phases.size > 0 && !filters.phases.has(a.id)) return false;
      if (filters.status === 'active' && !g.active) return false;
      if (filters.status === 'inactive' && g.active) return false;
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
          <col style="width: 56px;">
          <col>
          <col style="width: 180px;">
          <col style="width: 200px;">
          <col style="width: 130px;">
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
      <td style="font-variant-numeric: tabular-nums; color: var(--color-text-secondary);">${escapeHtml(g.id)}</td>
      <td>
        <div style="font-weight:500;">${escapeHtml(g.name)}</div>
        ${g.description ? `<div style="font-size: var(--text-small); color: var(--color-text-secondary);">${escapeHtml(g.description)}</div>` : ''}
      </td>
      <td>
        <button type="button" class="badge badge-domain badge-filterable"
                data-filter-phase="${escapeAttr(a.id)}"
                ${filterActive ? 'aria-pressed="true"' : ''}
                title="Nach Bereich filtern">${escapeHtml(a.name)}</button>
      </td>
      <td>${owner ? `<div>${escapeHtml(owner.name)}</div>${owner.org ? `<div style="font-size: var(--text-small); color: var(--color-text-secondary);">${escapeHtml(owner.org)}</div>` : ''}` : '<span style="color: var(--color-text-placeholder);">—</span>'}</td>
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

      ${group.description ? `<p class="process-description">${escapeHtml(group.description)}</p>` : ''}

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
  const hasDescription = !!group.description;
  const responsibleList = (group.responsible || []).map(renderPersonInline).join('<br>') || dash;
  const tagsHtml = (group.tags || []).length
    ? (group.tags || []).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join(' ')
    : dash;

  const standards   = group.standards   || [];
  const linkedProcs = group.linkedProcesses || {};
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
      <div class="section-label">Zweck / Bemerkungen</div>
      ${hasDescription
        ? `<p class="process-description" style="margin:0;">${escapeHtml(group.description)}</p>`
        : `<p style="margin:0; color: var(--color-text-placeholder);">Keine Beschreibung hinterlegt.</p>`}
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
        { label: 'Sammlung',              value: escapeHtml(c.name) },
        { label: 'Bereich', value: escapeHtml(area.name) },
        { label: 'Tags',                  value: tagsHtml },
        { label: 'Status',                value: renderStatusBadge(group.status) },
        { label: 'Version',               value: group.version ? escapeHtml(group.version) : dash },
        { label: 'Aktualisiert',          value: group.updatedAt ? escapeHtml(group.updatedAt) : dash },
        { label: 'Review-Zyklus',         value: group.reviewCycleMonths ? `${group.reviewCycleMonths} Monate` : dash }
      ])}
    </section>

    <section class="content-section">
      <div class="section-label">Grundlagen</div>
      ${standards.length
        ? `<ul class="bullet-list">${standards.map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>`
        : `<p style="margin:0; color: var(--color-text-placeholder);">Keine Grundlagen erfasst.</p>`}
    </section>

    <section class="content-section">
      <div class="section-label">Beziehungen zu anderen Prozessen</div>
      ${linkedTotal === 0
        ? `<p style="margin:0; color: var(--color-text-placeholder);">Keine Verknüpfungen erfasst.</p>`
        : propsTable([
            { label: 'Vorgänger',  value: renderLinkedProcesses(c, linkedProcs.predecessor) },
            { label: 'Nachfolger', value: renderLinkedProcesses(c, linkedProcs.successor)   },
            { label: 'Verwandt',   value: renderLinkedProcesses(c, linkedProcs.related)     }
          ])}
      <div class="detail-footnote">
        Quelldatei: ${group.bpmn
          ? `<code>${escapeHtml(group.bpmn)}</code>`
          : dash}
      </div>
    </section>
  `;
}

function renderLinkedProcesses(c, ids) {
  if (!ids || ids.length === 0) return '<span style="color: var(--color-text-placeholder);">—</span>';
  return ids.map(pid => {
    const hit = findGroupInCollection(c, pid);
    if (hit) {
      const href = `#/c/${encodeURIComponent(c.id)}/process/${encodeURIComponent(pid)}`;
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

// ─── Placeholder / recents views ────────────────────────────────────
function renderPlaceholder(title, body) {
  return `<div class="content-wrapper">
    ${renderBreadcrumb([{ label: 'Home', hash: '#/' }, { label: title }])}
    <h1 class="title-block-name" style="margin-bottom: var(--space-3);">${escapeHtml(title)}</h1>
    <p style="color: var(--color-text-secondary); max-width: var(--prose-max-width);">${escapeHtml(body)}</p>
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
