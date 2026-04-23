// views.js - all view renderers (home, collection, process, chat,
// workflows, search, recents, sidebar helpers). Pure HTML-building
// functions; mutate state only through routed re-render.

function renderHome() {
  const kpis = computeKpis();

  const kpiCards = [
    { icon: 'folder-tree',  count: kpis.collections, label: 'Sammlungen', sub: 'Prozess-Sammlungen' },
    { icon: 'list-tree',    count: kpis.processes,   label: 'Prozesse',   sub: 'Level-2 und tiefer' },
    { icon: 'file-check',   count: kpis.withBpmn,    label: 'Mit Diagramm', sub: 'BPMN verfügbar' },
    { icon: 'file-x',       count: kpis.withoutBpmn, label: 'Ohne Diagramm', sub: 'Kein BPMN hinterlegt' }
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
              <col style="width: var(--col-id);">
              <col style="width: var(--col-primary);">
              <col style="width: var(--col-count);">
              <col style="width: var(--col-count);">
              <col style="width: var(--col-date);">
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Nr.</th>
                <th scope="col">Name</th>
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
    walkTree(c.landscape, (node, path) => {
      if (path.length >= 2 && node.updatedAt) {
        all.push({ c, node, path });
      }
    });
  });
  if (all.length === 0) {
    return `<p class="text-secondary">Keine Aktivitäten erfasst.</p>`;
  }
  all.sort((x, y) => (y.node.updatedAt || '').localeCompare(x.node.updatedAt || ''));
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
          ${top.map(({ c, node, path }) => {
            const href = hashForNode(c.id, path);
            return `
              <tr class="clickable-row" data-href="${escapeAttr(href)}">
                <td class="tabular-nums">${escapeHtml(node.id)}</td>
                <td>${escapeHtml(node.name)}</td>
                <td>${escapeHtml(c.name)}</td>
                <td>${renderStatusBadge(node.status)}</td>
                <td>${escapeHtml(node.updatedAt)}</td>
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
      <td class="tabular-nums">${c.code ? escapeHtml(c.code) : '<span class="text-placeholder">—</span>'}</td>
      <td class="coll-row-name">${escapeHtml(c.name)}</td>
      <td class="tabular-nums">${count}</td>
      <td class="tabular-nums">${bpmn}</td>
      <td>${escapeHtml(c.updatedAt || '—')}</td>
    </tr>
  `;
}

function computeKpis() {
  let processes = 0, withBpmn = 0, withoutBpmn = 0;
  state.collections.forEach(c => {
    walkTree(c.landscape, (node, path) => {
      if (path.length >= 2) {
        processes++;
        if (isProcessNode(node)) withBpmn++; else withoutBpmn++;
      }
    });
  });
  return { collections: state.collections.length, processes, withBpmn, withoutBpmn };
}

// renderContainer: replaces renderCollection. Drives the landing view for
// ANY container node — collection root, Level 1, or a Level 2 that has
// children. Same tab-bar (Tabelle / Diagramm); same filters; tiles/table
// show all descendant processes (nodes at depth ≥ 2 under the current).
function renderContainer(c, node, trail, view) {
  const collectionPath = trail.map(n => n.id);
  const filters = state.filters[c.id];
  const f = buildFilterContext(c, node, trail, filters);
  const breadcrumbs = [{ label: 'Home', hash: '#/' }];
  breadcrumbs.push({ label: c.name, hash: `#/c/${encodeURIComponent(c.id)}` });
  for (let i = 0; i < trail.length; i++) {
    const link = i < trail.length - 1
      ? hashForNode(c.id, collectionPath.slice(0, i + 1))
      : null;
    breadcrumbs.push({
      label: `${trail[i].id} ${trail[i].name}`,
      hash: link || undefined
    });
  }

  const titleCode = trail.length ? trail[trail.length - 1].id : (c.code || '');
  const titleName = trail.length ? trail[trail.length - 1].name : c.name;
  const baseHash = hashForNode(c.id, collectionPath);

  addRecent({
    title: trail.length
      ? `${c.name} · ${titleCode} ${titleName}`
      : c.name,
    hash: baseHash
  });

  return `
    <div class="content-wrapper">
      ${renderBreadcrumb(breadcrumbs)}

      <div class="title-block">
        <div class="title-block-icon">
          <i data-lucide="${trail.length ? 'folder' : 'folder-tree'}" style="width:20px;height:20px;"></i>
        </div>
        <div class="title-block-content">
          <h1 class="title-block-name">
            ${titleCode ? `<code class="title-code">${escapeHtml(titleCode)}</code> ` : ''}${escapeHtml(titleName)}
          </h1>
        </div>
        ${renderTitleBlockActions({ context: 'container', payload: f.filtered })}
      </div>

      <div class="tab-bar" role="tablist">
        <div class="tab-bar-scroll">
          <button class="tab ${view === 'diagram' ? 'active' : ''}" data-nav="${hashForNode(c.id, collectionPath)}" role="tab" aria-selected="${view === 'diagram'}">Diagramm</button>
          <button class="tab ${view === 'table' ? 'active' : ''}" data-nav="${hashForNode(c.id, collectionPath, { view: 'table' })}" role="tab" aria-selected="${view === 'table'}">Tabelle</button>
        </div>
        ${f.toggleHtml}
        ${renderGroupingDropdown(c.id)}
        ${f.panelHtml}
      </div>

      ${f.pillsHtml}

      ${view === 'diagram' ? renderDiagramView(c, f.rows) : renderTableView(c, f.rows)}
    </div>
  `;
}

// buildFilterContext now operates on a subtree rooted at `node`. It collects
// descendant "process" rows ({node, path}), applies owner/status filters,
// and assembles the toggle + pill + panel chrome.
function buildFilterContext(c, rootNode, trail, filters) {
  const basePath = trail.map(n => n.id);
  // Descendants that represent "processes" (Level-2+ nodes). Plus the
  // node itself is excluded; only its descendants are shown.
  const allRows = [];
  const visit = (n, path) => {
    if (!isContainerNode(n) || isProcessNode(n)) {
      // leaf row for the table (or process-with-children, which we also list)
      if (path.length >= basePath.length + 1) {
        allRows.push({ node: n, path });
      }
    }
    for (const ch of n.children || []) visit(ch, [...path, ch.id]);
  };
  for (const ch of rootNode.children || []) visit(ch, [...basePath, ch.id]);

  const rows = allRows.filter(({ node }) => {
    if (filters.owners.size   > 0 && !filters.owners.has(node.owner))     return false;
    if (filters.statuses.size > 0 && !filters.statuses.has(node.status))  return false;
    return true;
  });

  const activeCount = filters.owners.size + filters.statuses.size;
  const panelOpen = state.filterPanelOpen;
  const toggleHtml = `
    <button type="button" class="grouping-btn filter-toggle" id="filter-toggle" aria-expanded="${panelOpen}" aria-controls="filter-panel">
      <i data-lucide="filter" style="width:14px;height:14px;"></i>
      <span>Filter</span>
      ${activeCount > 0 ? `<span class="filter-toggle-badge">${activeCount}</span>` : ''}
      <i data-lucide="chevron-down" style="width:14px;height:14px;"></i>
    </button>
  `;

  // Owner chip population — aggregated across the current subtree only.
  const ownerIds = new Set();
  allRows.forEach(({ node }) => { if (node.owner) ownerIds.add(node.owner); });
  const owners = [...ownerIds]
    .map(id => ({ id, person: resolvePerson(id) }))
    .sort((x, y) => (x.person?.name || x.id).localeCompare(y.person?.name || y.id, 'de'));
  const statusKeys = Object.keys(STATUS_LABELS);

  const removePill = (dim, val, dimLabel, valLabel) => `
    <span class="filter-pill">
      <span class="filter-pill-dim">${escapeHtml(dimLabel)}:</span>
      <span class="filter-pill-val">${escapeHtml(valLabel)}</span>
      <button type="button" class="filter-pill-remove" data-pill-${dim}="${escapeAttr(val)}" aria-label="Filter entfernen"><i data-lucide="x" style="width:10px;height:10px;"></i></button>
    </span>`;

  let pills = '';
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

  return { rows, toggleHtml, pillsHtml, panelHtml };
}

function renderDiagramView(c, rows) {
  if (rows.length === 0) {
    return `<div class="empty-state">Keine Prozesse passen zu den aktuellen Filtern.</div>`;
  }
  const grouping = state.grouping[c.id] || 'parent';
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
              ${gr.rows.map(r => renderTile(c, r.node, r.path)).join('')}
            </div>
          </section>
        `).join('')}
      </div>
    </section>
  `;
}

function renderTile(c, node, path) {
  const href = hashForNode(c.id, path);
  return `
    <a href="${href}" class="tile" aria-label="${escapeAttr(node.name)}">
      <div class="tile-number">${escapeHtml(node.id)}</div>
      <div class="tile-name">${escapeHtml(node.name)}</div>
    </a>
  `;
}

function renderTableView(c, rows) {
  if (rows.length === 0) {
    return `<div class="empty-state">Keine Prozesse passen zu den aktuellen Filtern.</div>`;
  }
  const grouping = state.grouping[c.id] || 'parent';
  const groups = groupRows(rows, grouping, c);
  return `
    <div class="list-panel">
      ${groups.map(gr => `
        <div class="group-header">
          <i data-lucide="chevron-down" style="width:16px;height:16px;"></i>
          <span class="group-header-title">${escapeHtml(gr.label)} (${gr.rows.length})</span>
        </div>
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
            <th scope="col">Gruppe</th>
            <th scope="col">Owner</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => renderProcessRow(c, r.node, r.path)).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderProcessRow(c, node, path) {
  const href = hashForNode(c.id, path);
  const owner = node.owner ? resolvePerson(node.owner) : null;
  // "Group" column = immediate parent in the tree (the Level-1 node for
  // Level-2 rows; the containing Level-2 for Level-3). Empty for L1 itself.
  let groupLabel = '—';
  if (path.length >= 2) {
    const parentPath = path.slice(0, -1);
    const hit = findNodeByPath(c, parentPath);
    if (hit) groupLabel = `${hit.node.id} ${hit.node.name}`;
  }
  return `
    <tr class="clickable-row" data-href="${escapeAttr(href)}">
      <td class="tabular-nums">${escapeHtml(node.id)}</td>
      <td>${escapeHtml(node.name)}</td>
      <td><span class="text-sub">${escapeHtml(groupLabel)}</span></td>
      <td>${owner ? escapeHtml(owner.name) : '<span class="text-placeholder">—</span>'}</td>
      <td>${renderStatusBadge(node.status)}</td>
    </tr>`;
}

function renderStatusBadge(status) {
  if (!status) return '<span class="text-placeholder">—</span>';
  const s = STATUS_LABELS[status];
  if (!s) return escapeHtml(status);
  return `<span class="badge ${s.badge}">${escapeHtml(s.label)}</span>`;
}

function renderGroupingDropdown(collId) {
  const active = state.grouping[collId] || 'parent';
  const activeLabel = GROUPING_OPTIONS.find(o => o.id === active)?.label || 'Gruppe';
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

// Row shape is always { node, path }. Grouping keys:
//   parent → group by immediate parent node in the tree (label = "{id} {name}")
//   owner  → group by owner person id
//   status → group by lifecycle status
//   none   → single "Prozesse" bucket
// `c` is the collection — needed by the 'parent' grouping so we can resolve
// the parent id to its display name.
function groupRows(rows, grouping, c) {
  if (grouping === 'none') {
    return [{ label: 'Prozesse', rows }];
  }
  const keyFn = {
    parent: ({ path }) => {
      if (path.length < 2) return { key: '__root', label: 'Wurzel' };
      const parentPath = path.slice(0, -1);
      const parentId = parentPath[parentPath.length - 1];
      const hit = c ? findNodeByPath(c, parentPath) : null;
      const name = hit?.node?.name;
      return { key: parentId, label: name ? `${parentId} ${name}` : parentId };
    },
    owner:  ({ node }) => {
      if (!node.owner) return { key: '__none', label: 'Ohne Owner' };
      const p = resolvePerson(node.owner);
      return { key: node.owner, label: p ? p.name : node.owner };
    },
    status: ({ node }) => {
      if (!node.status) return { key: '__none', label: 'Ohne Status' };
      const s = STATUS_LABELS[node.status];
      return { key: node.status, label: s ? s.label : node.status };
    }
  }[grouping] || (() => ({ key: '__all', label: 'Prozesse' }));

  const map = new Map();
  rows.forEach(r => {
    const { key, label } = keyFn(r);
    if (!map.has(key)) map.set(key, { label, rows: [] });
    map.get(key).rows.push(r);
  });

  const out = [...map.values()];
  // Natural id sort for 'parent' grouping (so TQ.21.00 < TQ.21.01, 1 < 2 < 10);
  // alpha sort for others, pushing "Ohne …" to the bottom.
  if (grouping === 'parent') {
    out.sort((x, y) => x.label.localeCompare(y.label, undefined, { numeric: true }));
  } else {
    out.sort((x, y) => {
      const xNone = /^Ohne /.test(x.label);
      const yNone = /^Ohne /.test(y.label);
      if (xNone !== yNone) return xNone ? 1 : -1;
      return x.label.localeCompare(y.label, 'de');
    });
  }
  return out;
}

// menuPayload is passed to renderExportMenu to render the kebab dropdown.
// Shape: { context: 'process'|'collection', payload: …same arg as renderExportDropdown }
// When absent (e.g., home, search), the kebab is omitted.
function renderTitleBlockActions(menuPayload) {
  const ins = state.inspector || {};
  const on = (section) => ins.open && ins.section === section ? ' is-active' : '';
  const btn = (section, icon, label) => `
    <button type="button" class="title-block-action-btn${on(section)}"
            data-inspector-toggle="${section}"
            aria-label="${escapeAttr(label)}" title="${escapeAttr(label)}"
            aria-pressed="${ins.open && ins.section === section}">
      <i data-lucide="${icon}" style="width:16px;height:16px;"></i>
    </button>`;

  const kebabHtml = menuPayload
    ? `<div class="title-block-more-wrap">
         <button type="button" class="title-block-action-btn${state.exportMenuOpen ? ' is-active' : ''}"
                 data-action="more"
                 aria-label="Weitere Aktionen" title="Weitere Aktionen"
                 aria-haspopup="menu" aria-expanded="${state.exportMenuOpen}"
                 aria-controls="titleblock-more-menu">
           <i data-lucide="more-vertical" style="width:16px;height:16px;"></i>
         </button>
         ${renderTitleBlockMoreMenu(menuPayload.context, menuPayload.payload)}
       </div>`
    : '';

  return `
    <div class="title-block-actions" role="toolbar" aria-label="Ansicht">
      ${btn('info',     'info',          'Informationen')}
      ${btn('comments', 'message-square','Kommentare')}
      <button type="button" class="title-block-action-btn" data-action="edit"
              aria-label="Bearbeiten" title="Bearbeiten">
        <i data-lucide="pencil" style="width:16px;height:16px;"></i>
      </button>
      <div class="title-block-actions-sep" aria-hidden="true"></div>
      <button type="button" class="title-block-action-btn" data-action="print"
              aria-label="Drucken" title="Drucken">
        <i data-lucide="printer" style="width:16px;height:16px;"></i>
      </button>
      <button type="button" class="title-block-action-btn" data-action="share"
              aria-label="Link teilen" title="Link teilen">
        <i data-lucide="share-2" style="width:16px;height:16px;"></i>
      </button>
      ${kebabHtml}
    </div>
  `;
}

// Export options dropdown, rendered inside the title-block kebab wrapper.
// Same option classes as before so the shared click handler in app.js
// (.grouping-option[data-export]) still routes correctly.
function renderTitleBlockMoreMenu(context, payload) {
  // Every container context shows "export everything in this subtree" —
  // tree walk ensures we find BPMN leaves at any depth.
  const hasBpmn = context === 'process'
    ? !!payload?.group?.bpmn
    : (payload || []).some(r => isProcessNode(r.node));
  const bpmnLabel = context === 'process' ? 'BPMN herunterladen' : 'BPMN als ZIP herunterladen';
  const disabledClass = hasBpmn ? '' : 'disabled';
  return `
    <div class="grouping-menu title-block-more-menu ${state.exportMenuOpen ? 'open' : ''}"
         id="titleblock-more-menu" role="menu">
      <div class="grouping-menu-section-label">Export</div>
      <div class="grouping-option" data-export="excel" role="menuitem">Als Excel (.xlsx)</div>
      <div class="grouping-option" data-export="pdf" role="menuitem">Als PDF</div>
      <div class="grouping-option ${disabledClass}" data-export="bpmn" role="menuitem">${escapeHtml(bpmnLabel)}</div>
    </div>
  `;
}


// New signature: renderProcess(c, node, trail, view).
// `node` is the process-bearing node (has .bpmn). `trail` is the chain of
// ancestor nodes from Level 1 down to this node. `view` is 'diagram' or 'steps'.
function renderProcess(c, node, trail, view) {
  const collectionPath = trail.map(n => n.id);
  const base = hashForNode(c.id, collectionPath);
  const elQuery = state.route.selectedElementId
    ? `?el=${encodeURIComponent(state.route.selectedElementId)}`
    : '';
  // tab-nav targets carry the selection forward (see syncSelectedElementUrl
  // for live updates on selection change). 'diagram' is the default view
  // for process nodes so we omit it from the Diagramm href.
  const diagramHref = hashForNode(c.id, collectionPath, {
    el: state.route.selectedElementId
  });
  const stepsHref = hashForNode(c.id, collectionPath, {
    view: 'steps',
    el: state.route.selectedElementId
  });

  const breadcrumbs = [{ label: 'Home', hash: '#/' }];
  breadcrumbs.push({ label: c.name, hash: `#/c/${encodeURIComponent(c.id)}` });
  for (let i = 0; i < trail.length; i++) {
    const link = i < trail.length - 1
      ? hashForNode(c.id, collectionPath.slice(0, i + 1))
      : null;
    breadcrumbs.push({
      label: `${trail[i].id} ${trail[i].name}`,
      hash: link || undefined
    });
  }

  addRecent({
    title: `${c.name} · ${node.id} ${node.name}`,
    hash: base
  });

  // The export menu payload needs the ancestry for PDF/Excel headers.
  const exportPayload = {
    c,
    area: trail.length >= 1 ? trail[0] : null,   // back-compat: "area" = Level 1
    group: node,
    trail
  };

  document.getElementById('main-content').innerHTML = `
    <div class="content-wrapper process-view">
      ${renderBreadcrumb(breadcrumbs)}

      <div class="title-block">
        <div class="title-block-icon">
          <i data-lucide="file-text" style="width:20px;height:20px;"></i>
        </div>
        <div class="title-block-content">
          <h1 class="title-block-name">
            <code class="title-code">${escapeHtml(node.id)}</code> ${escapeHtml(node.name)}
          </h1>
        </div>
        ${renderTitleBlockActions({ context: 'process', payload: exportPayload })}
      </div>

      <div class="tab-bar" role="tablist">
        <div class="tab-bar-scroll">
          <button class="tab ${view === 'diagram' ? 'active' : ''}" data-process-tab="diagram" data-nav="${escapeAttr(diagramHref)}" role="tab" aria-selected="${view === 'diagram'}">Diagramm</button>
          <button class="tab ${view === 'steps' ? 'active' : ''}" data-process-tab="steps" data-nav="${escapeAttr(stepsHref)}" role="tab" aria-selected="${view === 'steps'}">Schritte</button>
        </div>
      </div>

      <div id="process-tab-content">
        ${view === 'steps' ? renderProcessStepsPane() : renderProcessDiagramPane(node)}
      </div>
    </div>
  `;

  if (view === 'steps') {
    loadProcessSteps(node);
  } else {
    if (!node.bpmn) {
      document.getElementById('bpmn-canvas').innerHTML = '';
      return;
    }
    loadBpmn(node.bpmn);
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

// Process metadata pane. `node` = the process-bearing tree node;
// `trail` is the ancestor chain. Structure mirrors the pre-tree version;
// "Bereich" row now surfaces whatever Level-1 node contains the process.
function renderProcessMetadataPane(c, node, trail) {
  const dash = '<span class="text-placeholder">—</span>';
  const emptyPara = msg => `<p class="text-placeholder" style="margin:0;">${escapeHtml(msg)}</p>`;

  const responsibleList = (node.responsible || []).map(renderPersonInline).join('<br>') || dash;
  const tagsHtml = (node.tags || []).length
    ? (node.tags || []).map(t => `<span class="tag-chip">${escapeHtml(t)}</span>`).join(' ')
    : dash;

  const outputs   = node.outputs   || [];
  const systems   = node.systems   || [];
  const standards = node.standards || [];
  const documents = node.documents || [];
  const linkedProcs = node.linkedProcesses || { predecessor: [], successor: [], related: [] };
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

  // Ancestor context: show the path of ancestors with their id+name.
  const level1 = trail.length >= 1 ? trail[0] : null;
  const parent = trail.length >= 2 ? trail[trail.length - 2] : level1;

  return `
    <section class="content-section">
      <div class="section-label">Prozessverantwortliche</div>
      ${propsTable([
        { label: 'Owner',                 value: renderPersonInline(node.owner) },
        { label: 'Responsible',           value: responsibleList },
        { label: 'Subject-Matter Expert', value: renderPersonInline(node.expert) }
      ])}
    </section>

    <section class="content-section">
      <div class="section-label">Zweck & Kontext</div>
      ${propsTable([
        { label: 'Beschreibung', value: node.description ? escapeHtml(node.description) : dash },
        { label: 'Zweck',        value: node.purpose     ? escapeHtml(node.purpose)     : dash },
        { label: 'Trigger',      value: node.trigger     ? escapeHtml(node.trigger)     : dash },
        { label: 'Ergebnisse',   value: outputs.length
            ? `<ul class="bullet-list" style="margin:0;">${outputs.map(o => `<li>${escapeHtml(o)}</li>`).join('')}</ul>`
            : dash }
      ])}
    </section>

    <section class="content-section">
      <div class="section-label">Einordnung & Status</div>
      ${propsTable([
        { label: 'Sammlung',       value: escapeHtml(c.name) },
        { label: 'Ebene 1',        value: level1 ? escapeHtml(level1.id + ' ' + level1.name) : dash },
        ...(parent && parent !== level1 ? [{ label: 'Über-Prozess', value: escapeHtml(parent.id + ' ' + parent.name) }] : []),
        { label: 'Klassifikation', value: node.classification ? escapeHtml(node.classification) : dash },
        { label: 'Tags',           value: tagsHtml },
        { label: 'Status',         value: renderStatusBadge(node.status) },
        { label: 'Version',        value: node.version    ? escapeHtml(node.version)    : dash },
        { label: 'Gültig ab',      value: node.validFrom  ? escapeHtml(node.validFrom)  : dash },
        { label: 'Gültig bis',     value: node.validUntil ? escapeHtml(node.validUntil) : dash },
        { label: 'Aktualisiert',   value: node.updatedAt  ? escapeHtml(node.updatedAt)  : dash },
        { label: 'Review-Zyklus',  value: node.reviewCycleMonths ? `${node.reviewCycleMonths} Monate` : dash }
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

// Container metadata: what we show for a Level-1 (or any container) node in
// the inspector — description + direct-child count + ancestors. Short, since
// these nodes carry less metadata than leaf processes.
function renderContainerMetadataPane(c, node, trail) {
  const dash = '<span class="text-placeholder">—</span>';
  const level1 = trail.length >= 1 ? trail[0] : null;
  const childCount = (node.children || []).length;
  return `
    <section class="content-section">
      <div class="section-label">Beschreibung</div>
      ${node.description
        ? `<p style="margin:0; line-height:1.6;">${escapeHtml(node.description)}</p>`
        : `<p class="text-placeholder" style="margin:0;">Keine Beschreibung hinterlegt.</p>`}
    </section>
    <section class="content-section">
      <div class="section-label">Einordnung</div>
      <table class="props-table">
        <tbody>
          <tr><th scope="row">Sammlung</th><td>${escapeHtml(c.name)}</td></tr>
          ${level1 && level1 !== node ? `<tr><th scope="row">Ebene 1</th><td>${escapeHtml(level1.id + ' ' + level1.name)}</td></tr>` : ''}
          <tr><th scope="row">Unterknoten</th><td>${childCount}</td></tr>
        </tbody>
      </table>
    </section>
  `;
}

function renderCollectionMetadataPane(c) {
  const ownerHtml = c.owner
    ? (c.ownerUrl
        ? `<a href="${escapeAttr(c.ownerUrl)}" target="_blank" rel="noopener">${escapeHtml(c.owner)}</a>`
        : escapeHtml(c.owner))
    : '<span class="text-placeholder">—</span>';
  return `
    <section class="content-section">
      <div class="section-label">Beschreibung</div>
      ${c.description
        ? `<p style="margin:0; line-height:1.6;">${escapeHtml(c.description)}</p>`
        : `<p class="text-placeholder" style="margin:0;">Keine Beschreibung hinterlegt.</p>`}
    </section>
    <section class="content-section">
      <div class="section-label">Herausgeber</div>
      <table class="props-table">
        <tbody>
          <tr><th scope="row">Sammlung</th><td>${c.code ? `<code>${escapeHtml(c.code)}</code> ` : ''}${escapeHtml(c.name)}</td></tr>
          <tr><th scope="row">Quelle</th><td>${ownerHtml}</td></tr>
          <tr><th scope="row">Aktualisiert</th><td>${escapeHtml(c.updatedAt || '—')}</td></tr>
        </tbody>
      </table>
    </section>
  `;
}

function renderLinkedProcesses(c, ids) {
  if (!ids || ids.length === 0) return '<span class="text-placeholder">—</span>';
  return ids.map(pid => {
    const path = findPathToId(c, pid);
    if (path) {
      const href = hashForNode(c.id, path);
      const hit = findNodeByPath(c, path);
      return `<a href="${escapeAttr(href)}">${escapeHtml(pid)} ${escapeHtml(hit?.node?.name || '')}</a>`;
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
//   - Sammlungen: match on name / code / description
//   - Prozesse:   match on id / name / description / purpose / tags
// Returns sorted results capped at `limit` per group.
function searchHub(q, limit) {
  const needle = (q || '').trim().toLowerCase();
  if (!needle) return { collections: [], processes: [] };

  const matches = (hay) => (hay || '').toLowerCase().includes(needle);

  const collections = state.collections
    .filter(c => matches(c.name) || matches(c.code) || matches(c.description))
    .slice(0, limit);

  const processes = [];
  for (const c of state.collections) {
    if (processes.length >= limit) break;
    walkTree(c.landscape, (node, path) => {
      if (processes.length >= limit) return;
      if (path.length < 2) return;   // Level-1 containers excluded from "Prozesse" results
      const hitTags = (node.tags || []).some(t => matches(t));
      if (matches(node.id) || matches(node.name) || matches(node.description) || matches(node.purpose) || hitTags) {
        processes.push({ c, node, path });
      }
    });
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
                <div class="search-dropdown-item-meta">Sammlung</div>
              </div>
            </div>`).join('')}
        </div>`;
      }
      if (processes.length) {
        html += `<div class="search-dropdown-group">
          <div class="search-dropdown-group-label">Prozesse</div>
          ${processes.map(({ c, node, path }) => `
            <div class="search-dropdown-item" data-href="${hashForNode(c.id, path)}" role="option">
              <div class="search-dropdown-item-icon"><i data-lucide="file-text" style="width:16px;height:16px;"></i></div>
              <div>
                <div class="search-dropdown-item-name">${escapeHtml(node.name)}</div>
                <div class="search-dropdown-item-meta">${escapeHtml(node.id)} · ${escapeHtml(c.name)}</div>
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
            <div class="search-result-type">Sammlung</div>
          </div>
        </div>`;
      }
    }
    if (processes.length) {
      body += `<div class="search-group-label">Prozesse <span style="color:var(--color-text-placeholder);font-weight:500;margin-left:4px;">${processes.length}</span></div>`;
      for (const { c, node, path } of processes) {
        body += `<div class="search-result-item" data-href="${hashForNode(c.id, path)}">
          <div class="search-result-icon"><i data-lucide="file-text" style="width:16px;height:16px;"></i></div>
          <div>
            <div class="search-result-name">${escapeHtml(node.name)}</div>
            <div class="search-result-type">${escapeHtml(node.id)} · ${escapeHtml(c.name)} ${renderStatusBadge(node.status)}</div>
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

// ─── Inspector panel ────────────────────────────────────────────────
// Right-side context-sensitive inspector. Sections are 'info' | 'comments'.
// The Info section adapts to what's in focus:
//   • process view, element selected → element attributes
//   • process view, no element       → process metadata (was the Metadaten tab)
//   • collection view                 → collection metadata
function renderInspector() {
  const ins = state.inspector || {};
  if (!ins.open) return '';

  const scope = getInspectorScope();
  const header = scope.header;

  const tab = (key, label) => `
    <button type="button" class="inspector-tab ${ins.section === key ? 'active' : ''}"
            data-inspector-section="${key}" role="tab"
            aria-selected="${ins.section === key}">
      ${escapeHtml(label)}
    </button>`;

  const body = ins.section === 'comments'
    ? renderInspectorCommentsSection(scope)
    : renderInspectorInfoSection(scope);

  return `
    <div class="inspector-header">
      <div class="inspector-header-text">
        <div class="inspector-header-title" title="${escapeAttr(header.title)}">${escapeHtml(header.title)}</div>
        <div class="inspector-header-sub">${header.sub || '&nbsp;'}</div>
      </div>
      <button type="button" class="inspector-close" id="inspector-close"
              aria-label="Inspektor schließen" title="Schließen">
        <i data-lucide="x" style="width:16px;height:16px;"></i>
      </button>
    </div>
    <div class="inspector-tabs" role="tablist">
      ${tab('info', 'Info')}
      ${tab('comments', `Kommentare${commentCountLabel(scope)}`)}
    </div>
    <div class="inspector-body">
      ${body}
    </div>
  `;
}

// Pick the focused entity for the inspector based on the current node route
// + selected BPMN element. Returns a scope object consumed by the renderers.
function getInspectorScope() {
  const r = state.route;
  if (r.name !== 'node') {
    return { kind: 'empty', header: { title: 'Inspektor', sub: '' } };
  }
  const resolved = resolveNodeRoute(r);
  if (!resolved) return { kind: 'empty', header: { title: 'Inspektor', sub: '' } };
  const { c, node, trail } = resolved;
  const el = state.inspector.element;

  // Element selected on a process diagram → element-attributes scope.
  if (el && isProcessNode(node)) {
    return {
      kind: 'element',
      element: el, c, node, trail,
      header: {
        title: el.name || el.typeLabel || el.id || 'Element',
        sub: `${escapeHtml(el.typeLabel || '')}${el.id ? ' · ' + escapeHtml(el.id) : ''}`
      }
    };
  }
  if (isProcessNode(node)) {
    const parent = trail.length >= 2 ? trail[trail.length - 2] : null;
    return {
      kind: 'process',
      c, node, trail,
      header: {
        title: node.name,
        sub: `${escapeHtml(node.id)}${parent ? ' · ' + escapeHtml(parent.name) : ''}`
      }
    };
  }
  // Collection root (trail empty) → collection metadata.
  if (trail.length === 0) {
    return {
      kind: 'collection',
      c,
      header: {
        title: (c.code ? c.code + ' ' : '') + c.name,
        sub: 'Sammlung'
      }
    };
  }
  // Container node (Level-1 or Level-2-with-children).
  return {
    kind: 'container',
    c, node, trail,
    header: {
      title: `${node.id} ${node.name}`,
      sub: trail.length >= 2
        ? escapeHtml(trail[trail.length - 2].name)
        : (c.code ? c.code + ' ' + c.name : c.name)
    }
  };
}

function commentCountLabel(scope) {
  const n = getCommentsForCurrent(scope?.element).length;
  return n > 0 ? ` (${n})` : '';
}

function renderInspectorInfoSection(scope) {
  if (scope.kind === 'element') {
    return renderInspectorElementAttributes(scope.element);
  }
  if (scope.kind === 'process') {
    return `<div class="inspector-metadata">
      ${renderProcessMetadataPane(scope.c, scope.node, scope.trail)}
    </div>`;
  }
  if (scope.kind === 'container') {
    return `<div class="inspector-metadata">
      ${renderContainerMetadataPane(scope.c, scope.node, scope.trail)}
    </div>`;
  }
  if (scope.kind === 'collection') {
    return `<div class="inspector-metadata">
      ${renderCollectionMetadataPane(scope.c)}
    </div>`;
  }
  return `<div class="inspector-empty">
    <p>Keine Informationen verfügbar.</p>
  </div>`;
}

function renderInspectorElementAttributes(el) {
  const dash = '<span class="text-placeholder">—</span>';
  const row = (label, value) => `
    <div class="inspector-kv">
      <div class="inspector-kv-k">${escapeHtml(label)}</div>
      <div class="inspector-kv-v">${value === null || value === undefined || value === '' ? dash : (typeof value === 'string' ? escapeHtml(value) : value)}</div>
    </div>`;
  return `
    <section class="inspector-section">
      <h3 class="inspector-section-title">Element-Attribute</h3>
      <div class="inspector-kv-list">
        ${row('Name', el.name)}
        ${row('Typ', el.typeLabel || el.type)}
        ${row('ID', el.id)}
        ${row('Lane / Pool', el.lane)}
        ${row('Eingehende', el.incoming != null ? String(el.incoming) : '')}
        ${row('Ausgehende', el.outgoing != null ? String(el.outgoing) : '')}
        ${row('Dokumentation', el.documentation)}
      </div>
    </section>
  `;
}

function renderInspectorCommentsSection(scope) {
  const el = scope?.element;
  const comments = getCommentsForCurrent(el);
  const list = comments.length === 0
    ? `<div class="inspector-empty-muted">Noch keine Kommentare.</div>`
    : comments.map(c => `
        <article class="inspector-comment" data-comment-id="${escapeAttr(c.id)}">
          <div class="inspector-comment-head">
            <span class="inspector-comment-author">${escapeHtml(c.author || 'DR')}</span>
            <span class="inspector-comment-time">${escapeHtml(relativeTime(c.createdAt))}</span>
            <button type="button" class="inspector-comment-del" data-comment-del="${escapeAttr(c.id)}"
                    aria-label="Kommentar löschen" title="Löschen">
              <i data-lucide="trash-2" style="width:13px;height:13px;"></i>
            </button>
          </div>
          <div class="inspector-comment-body">${escapeHtml(c.text)}</div>
        </article>
      `).join('');

  const scopeLabel =
    scope?.kind === 'element'    ? `Kommentare zu Element <code>${escapeHtml(el.id)}</code>`
    : scope?.kind === 'process'  ? `Kommentare zum Prozess`
    : scope?.kind === 'collection' ? `Kommentare zur Sammlung`
    :                               `Kommentare`;

  return `
    <section class="inspector-section">
      <h3 class="inspector-section-title">${scopeLabel}</h3>
      <div class="inspector-comments">
        ${list}
      </div>
      <form class="inspector-comment-form" id="inspector-comment-form">
        <textarea class="inspector-comment-input" id="inspector-comment-input"
                  placeholder="Kommentar schreiben…" rows="2"
                  aria-label="Neuer Kommentar"></textarea>
        <div class="inspector-comment-form-row">
          <span class="text-sub">Prototyp — lokal gespeichert (localStorage).</span>
          <button type="submit" class="btn-primary inspector-comment-submit">Senden</button>
        </div>
      </form>
    </section>
  `;
}

function relativeTime(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (isNaN(then)) return '';
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 60) return 'gerade eben';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `vor ${diffMin} Min.`;
  const diffH = Math.round(diffMin / 60);
  if (diffH < 24) return `vor ${diffH} Std.`;
  const diffD = Math.round(diffH / 24);
  if (diffD < 14) return `vor ${diffD} Tagen`;
  return new Date(iso).toLocaleDateString('de-DE');
}
