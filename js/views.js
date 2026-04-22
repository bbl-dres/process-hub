// views.js - all view renderers (home, collection, process, chat,
// workflows, search, recents, sidebar helpers). Pure HTML-building
// functions; mutate state only through routed re-render.

function renderHome() {
  const kpis = computeKpis();

  const kpiCards = [
    { icon: 'folder-tree',  count: kpis.collections, label: 'Sammlungen', sub: 'Prozess-Sammlungen' },
    { icon: 'list-tree',    count: kpis.processes,   label: 'Prozesse',   sub: 'Gesamtzahl Teilprozesse' },
    { icon: 'file-check',   count: kpis.withBpmn,    label: 'Mit Diagramm', sub: 'BPMN verfügbar' },
    { icon: 'file-x',       count: kpis.withoutBpmn, label: 'Ohne Diagramm', sub: 'Kein BPMN hinterlegt' },
    { icon: 'layers',       count: kpis.areas,       label: 'Bereiche',   sub: 'Level-2-Gruppierungen' },
  ];

  const skipped = state.skippedCollections || [];
  const skipBanner = skipped.length
    ? `<div class="load-error-banner" role="alert">
        <i data-lucide="alert-triangle" style="width:16px;height:16px;"></i>
        <div>
          <strong>${skipped.length === 1 ? '1 Sammlung' : `${skipped.length} Sammlungen`} konnten nicht geladen werden.</strong>
          <div class="text-sub">${skipped.map(s => escapeHtml(s.name || s.id)).join(' · ')} — Details in der Konsole.</div>
        </div>
      </div>`
    : '';

  return `
    <div class="content-wrapper">
      <div class="title-block">
        <div class="title-block-icon">
          <i data-lucide="workflow" style="width:20px;height:20px;"></i>
        </div>
        <div class="title-block-content">
          <h1 class="title-block-name">Prozess-Hub</h1>
        </div>
      </div>

      ${skipBanner}

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

      <section class="content-section">
        <div class="section-label">Prozess-Sammlungen</div>
        <div class="data-table-wrap">
          <table class="data-table">
            <colgroup>
              <col style="width: var(--col-primary);">
              <col style="width: var(--col-count);">
              <col style="width: var(--col-count);">
              <col style="width: var(--col-count);">
              <col style="width: var(--col-date);">
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
      </section>

      <section class="content-section">
        <div class="section-label">Letzte Aktivitäten</div>
        ${renderRecentActivityTable()}
      </section>
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
    return `<p class="text-secondary">Keine Aktivitäten erfasst.</p>`;
  }
  all.sort((x, y) => (y.g.updatedAt || '').localeCompare(x.g.updatedAt || ''));
  const top = all.slice(0, 5);
  return `
    <div class="data-table-wrap">
      <table class="data-table">
        <colgroup>
          <col style="width: var(--col-id);">
          <col style="width: var(--col-primary);">
          <col style="width: var(--col-area);">
          <col style="width: var(--col-status);">
          <col style="width: var(--col-date);">
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
                <td class="tabular-nums">${escapeHtml(g.id)}</td>
                <td>${escapeHtml(g.name)}</td>
                <td>${escapeHtml(c.name)}</td>
                <td>${renderStatusBadge(g.status)}</td>
                <td>${escapeHtml(g.updatedAt)}</td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
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
        ${c.subtitle ? `<div class="text-sub">${escapeHtml(c.subtitle)}</div>` : ''}
      </td>
      <td class="tabular-nums">${c.landscape.areas.length}</td>
      <td class="tabular-nums">${count}</td>
      <td class="tabular-nums">${bpmn}</td>
      <td class="text-sub">${escapeHtml(c.updatedAt || '—')}</td>
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
        </div>
      </div>

      <div class="tab-bar" role="tablist">
        <div class="tab-bar-scroll">
          <button class="tab ${view === 'table' ? 'active' : ''}" data-nav="#/c/${encodeURIComponent(c.id)}${encodeCollectionQuery(c.id)}" role="tab" aria-selected="${view === 'table'}">Tabelle</button>
          <button class="tab ${view === 'diagram' ? 'active' : ''}" data-nav="#/c/${encodeURIComponent(c.id)}/diagram${encodeCollectionQuery(c.id)}" role="tab" aria-selected="${view === 'diagram'}">Diagramm</button>
          <button class="tab ${view === 'metadata' ? 'active' : ''}" data-nav="#/c/${encodeURIComponent(c.id)}/metadata${encodeCollectionQuery(c.id)}" role="tab" aria-selected="${view === 'metadata'}">Metadaten</button>
        </div>
        ${view !== 'metadata' ? f.toggleHtml : ''}
        ${view !== 'metadata' ? renderGroupingDropdown(c.id) : ''}
        ${renderExportDropdown('collection', f.filtered)}
        ${view !== 'metadata' ? f.panelHtml : ''}
      </div>

      ${view !== 'metadata' ? f.pillsHtml : ''}

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
    : '<span class="text-placeholder">—</span>';

  return `
    <section class="content-section">
      <div class="section-label">Beschreibung</div>
      ${c.description
        ? `<p style="margin:0; max-width: var(--prose-max-width); line-height:1.6;">${escapeHtml(c.description)}</p>`
        : `<p class="text-placeholder" style="margin:0;">Keine Beschreibung hinterlegt.</p>`}
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
  // Apply filters: group passes if it matches ALL active dimensions.
  // Empty set for a dimension means "don't filter on this dimension."
  const filtered = c.landscape.areas.map(a => ({
    ...a,
    groups: a.groups.filter(g => {
      if (filters.phases.size   > 0 && !filters.phases.has(a.id))      return false;
      if (filters.owners.size   > 0 && !filters.owners.has(g.owner))   return false;
      if (filters.statuses.size > 0 && !filters.statuses.has(g.status)) return false;
      return true;
    })
  })).filter(a => a.groups.length > 0);

  const activeCount = filters.phases.size + filters.owners.size + filters.statuses.size;
  const panelOpen = state.filterPanelOpen;

  const toggleHtml = `
    <button type="button" class="grouping-btn filter-toggle" id="filter-toggle" aria-expanded="${panelOpen}" aria-controls="filter-panel">
      <i data-lucide="filter" style="width:14px;height:14px;"></i>
      <span>Filter</span>
      ${activeCount > 0 ? `<span class="filter-toggle-badge">${activeCount}</span>` : ''}
      <i data-lucide="chevron-down" style="width:14px;height:14px;"></i>
    </button>
  `;

  // Collect the owners that actually appear on processes in this collection.
  const ownerIds = new Set();
  c.landscape.areas.forEach(a => a.groups.forEach(g => { if (g.owner) ownerIds.add(g.owner); }));
  const owners = [...ownerIds]
    .map(id => ({ id, person: resolvePerson(id) }))
    .sort((x, y) => (x.person?.name || x.id).localeCompare(y.person?.name || y.id, 'de'));

  // Lifecycle statuses — show every defined enum (even if not present in
  // this collection) so filter options are predictable across collections.
  const statusKeys = Object.keys(STATUS_LABELS);

  const removePill = (dim, val, dimLabel, valLabel) => `
    <span class="filter-pill">
      <span class="filter-pill-dim">${escapeHtml(dimLabel)}:</span>
      <span class="filter-pill-val">${escapeHtml(valLabel)}</span>
      <button type="button" class="filter-pill-remove" data-pill-${dim}="${escapeAttr(val)}" aria-label="Filter entfernen"><i data-lucide="x" style="width:10px;height:10px;"></i></button>
    </span>`;

  let pills = '';
  filters.phases.forEach(phaseId => {
    const a = c.landscape.areas.find(x => x.id === phaseId);
    if (a) pills += removePill('phase', phaseId, 'Bereich', a.name);
  });
  filters.owners.forEach(ownerId => {
    const p = resolvePerson(ownerId);
    pills += removePill('owner', ownerId, 'Owner', p?.name || ownerId);
  });
  filters.statuses.forEach(st => {
    pills += removePill('status', st, 'Status', STATUS_LABELS[st]?.label || st);
  });

  const pillsHidden = activeCount === 0 || panelOpen;
  const pillsHtml = activeCount > 0
    ? `<div class="filter-pill-row" id="filter-pills" ${pillsHidden ? 'hidden' : ''}>${pills}<button type="button" class="filter-reset" id="filter-reset">Alle entfernen</button></div>`
    : '';

  const chip = (attr, val, label, active) => `
    <label class="filter-chip ${active ? 'active' : ''}">
      <input type="checkbox" data-filter-${attr}="${escapeAttr(val)}" ${active ? 'checked' : ''}>
      <span>${escapeHtml(label)}</span>
    </label>`;

  const panelHtml = `
    <div class="filter-panel" id="filter-panel" ${panelOpen ? '' : 'hidden'}>
      <div class="filter-group">
        <div class="filter-group-label">Bereich</div>
        <div class="filter-group-options">
          ${c.landscape.areas.map(a =>
            chip('phase', a.id, a.name, filters.phases.has(a.id))
          ).join('')}
        </div>
      </div>
      <div class="filter-group">
        <div class="filter-group-label">Owner</div>
        <div class="filter-group-options">
          ${owners.length
            ? owners.map(({ id, person }) =>
                chip('owner', id, person?.name || id, filters.owners.has(id))
              ).join('')
            : '<span class="text-placeholder">Keine Owner erfasst.</span>'}
        </div>
      </div>
      <div class="filter-group">
        <div class="filter-group-label">Status</div>
        <div class="filter-group-options">
          ${statusKeys.map(s =>
            chip('status', s, STATUS_LABELS[s].label, filters.statuses.has(s))
          ).join('')}
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

  const grouping = state.grouping[c.id] || 'area';

  // When grouped by Bereich we keep the original areas (preserves per-area
  // accent colors on the cards). For other groupings we flatten + re-group
  // through the shared `groupRows` helper — exact same keying as Tabelle.
  if (grouping === 'area') {
    return `
      <section class="landscape-diagram">
        <div class="landscape-canvas">
          ${areas.map(a => renderAreaCard(c, a)).join('')}
        </div>
      </section>
    `;
  }

  // Flatten (preserving area reference so tiles keep their accent).
  const rows = [];
  areas.forEach(a => a.groups.forEach(g => rows.push({ a, g })));
  const groups = groupRows(rows, grouping, c);

  return `
    <section class="landscape-diagram">
      <div class="landscape-canvas">
        ${groups.map(gr => `
          <section class="area-card">
            <header class="area-card-header">
              <h3 class="area-card-title">${escapeHtml(gr.label)} <span class="text-placeholder" style="font-weight:400;">(${gr.rows.length})</span></h3>
            </header>
            <div class="tile-grid">
              ${gr.rows.map(({ a, g }) => renderTile(c, g, a.accent)).join('')}
            </div>
          </section>
        `).join('')}
      </div>
    </section>
  `;
}

function renderAreaCard(c, area) {
  return `
    <section class="area-card" style="--area-accent:${area.accent || 'var(--color-border-strong)'}">
      <header class="area-card-header">
        <h3 class="area-card-title">${escapeHtml(area.name)} <span class="text-placeholder" style="font-weight:400;">(${area.groups.length})</span></h3>
      </header>
      <div class="tile-grid">
        ${area.groups.map(g => renderTile(c, g)).join('')}
      </div>
    </section>
  `;
}

function renderTile(c, group, accent) {
  const href = `#/c/${encodeURIComponent(c.id)}/process/${encodeURIComponent(group.id)}`;
  // The default rendering (Bereich grouping) inherits --area-accent from
  // the parent .area-card. When the caller regroups across areas (owner /
  // status), pass the tile's source-area accent explicitly so colour
  // coding survives the regrouping.
  const accentStyle = accent ? ` style="--area-accent:${accent}"` : '';
  return `
    <a href="${href}" class="tile"${accentStyle} aria-label="${escapeAttr(group.name)}">
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
          <col style="width: var(--col-id);">
          <col style="width: var(--col-primary);">
          <col style="width: var(--col-area);">
          <col style="width: var(--col-person);">
          <col style="width: var(--col-status);">
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
      <td class="tabular-nums">${escapeHtml(g.id)}</td>
      <td>${escapeHtml(g.name)}</td>
      <td>
        <button type="button" class="badge badge-domain badge-filterable"
                data-filter-phase="${escapeAttr(a.id)}"
                ${filterActive ? 'aria-pressed="true"' : ''}
                title="Nach Bereich filtern">${escapeHtml(a.name)}</button>
      </td>
      <td>${owner ? escapeHtml(owner.name) : '<span class="text-placeholder">—</span>'}</td>
      <td>${renderStatusBadge(g.status)}</td>
    </tr>`;
}

function renderStatusBadge(status) {
  if (!status) return '<span class="text-placeholder">—</span>';
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
    // Still emit a single group so the header-with-count renders — matches
    // the data-catalog pattern of always showing "<label> (N)" above the
    // table, even when there's no real grouping.
    return [{ label: 'Prozesse', rows }];
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
  const dash = '<span class="text-placeholder">—</span>';
  const emptyPara = msg => `<p class="text-placeholder" style="margin:0;">${escapeHtml(msg)}</p>`;

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
      <div class="section-label">Prozessverantwortliche</div>
      ${propsTable([
        { label: 'Owner',                 value: renderPersonInline(group.owner) },
        { label: 'Responsible',           value: responsibleList },
        { label: 'Subject-Matter Expert', value: renderPersonInline(group.expert) }
      ])}
    </section>

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
  if (!ids || ids.length === 0) return '<span class="text-placeholder">—</span>';
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
  if (!id) return '<span class="text-placeholder">—</span>';
  const p = resolvePerson(id);
  if (!p) return escapeHtml(id);
  return `<div>${escapeHtml(p.name)}</div>${p.org ? `<div class="text-sub">${escapeHtml(p.org)}</div>` : ''}`;
}

function renderChatView() {
  return `<div class="content-wrapper">
    ${renderBreadcrumb([{ label: 'Home', hash: '#/' }, { label: 'KI-Assistent' }])}

    <div class="title-block">
      <div class="title-block-icon">
        <i data-lucide="sparkles" style="width:20px;height:20px;"></i>
      </div>
      <div class="title-block-content">
        <h1 class="title-block-name">KI-Assistent</h1>
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
      </div>
    </div>

    <section class="content-section">
      <div class="section-label">Export</div>
      <div class="data-table-wrap">
        <table class="data-table">
          <colgroup>
            <col style="width: var(--col-primary);">
            <col style="width: var(--col-count);">
            <col style="width: var(--col-count);">
            <col>
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
                  <td class="tabular-nums">${total}</td>
                  <td class="tabular-nums">${withBpmn}</td>
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
        </div>
      </div>
      <p class="text-secondary">Geben Sie oben einen Suchbegriff ein.</p>
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
      <p class="text-secondary">Keine Sammlungen oder Prozesse passen zu „${escapeHtml(trimmed)}".</p>
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
        <h1 class="title-block-name">${total} ${noun} für „${escapeHtml(trimmed)}"</h1>
      </div>
    </div>
    ${body}
  </div>`;
}
