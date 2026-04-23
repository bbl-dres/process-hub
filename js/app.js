// app.js - entry, state, router, sidebar, global handlers.
// Shared helpers used by views/exports/bpmn: escapeHtml, escapeAttr,
// resolvePerson, totalProcesses, processesWithBpmn, walkTree,
// findNodeByPath, findPathToId, hashForNode, addRecent, renderBreadcrumb.

// Process Hub Reader — main app
// Loads all collections at boot. Renders Home (KPIs + table), Collection
// landing (diagram/table toggle), and Process view (BPMN).

// ─── State ──────────────────────────────────────────────────────────
const state = {
  collections: [],        // [{ ...index, landscape: { id, areas: [...] } }]
  people: {},             // { personId: { id, name, org, email } }
  route: { name: 'home' },
  filters: {},            // filters[collId] = { owners: Set, statuses: Set }
  filterPanelOpen: false,
  grouping: {},           // grouping[collId] = 'area' | 'owner' | 'status' | 'none'
  groupingMenuOpen: false,
  exportMenuOpen: false,  // shared between collection and process export dropdowns
  expandedCollections: new Set(),  // sidebar tree: which collections are expanded
  expandedNodes: new Set(),        // expanded state for inner tree nodes, keyed "{collId}|id1|id2|…"
  autoExpandedCollections: new Set(),  // which we auto-opened on entry — don't re-expand once the user collapses
  skippedCollections: [],  // populated in init() when a collection fails to load/validate
  recents: [],
  bpmnViewer: null,
  bpmnLastXml: null,          // last-imported BPMN XML, for lane-map reconstruction on re-select
  bpmnMarkedId: null,         // id of the shape currently painted with .ph-selected-shape (NavigatedViewer has no selection service)
  processSteps: [],           // latest parseBpmnSteps() output, for Schritte-row click lookup
  // Right-side element inspector (Info / Kommentare). Defaults to open so
  // context-sensitive metadata is visible on first load; users can dismiss it.
  inspector: {
    open: true,
    section: 'info',        // 'info' | 'comments'   (legacy 'attributes' → migrated to 'info' on read)
    element: null           // { id, name, type, typeLabel, lane, incoming, outgoing, documentation } | null
  }
};

const GROUPING_OPTIONS = [
  { id: 'parent', label: 'Gruppe' },
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
const EXPANDED_NODES_KEY = 'processHub.expandedNodes';
const INSPECTOR_KEY    = 'processHub.inspectorOpen';
const INSPECTOR_WIDTH_KEY = 'processHub.inspectorWidth';
const INSPECTOR_MIN_WIDTH = 260;
const INSPECTOR_MAX_WIDTH = 640;
const COMMENTS_KEY     = 'processHub.comments';        // all comments under one key as JSON map
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
        owners:   new Set(),   // person IDs (from people.json)
        statuses: new Set()    // lifecycle: approved | in-review | draft | deprecated
      };
      state.grouping[c.id] = 'none';
    });
  } catch (err) {
    showFatalError(err);
    return;
  }

  migrateRecents();
  wireGlobalHandlers();
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('app').style.display = '';
  handleRoute();
}

// One-time rewrite: old recents entries pointed at #/c/{collId}/process/{pid}.
// Resolve those through the tree and rewrite to canonical /n/ hashes so
// clicking the "Zuletzt angesehen" list routes to the new view. Skips any
// entry we can't resolve (the tree-search returns null).
function migrateRecents() {
  let dirty = false;
  state.recents = state.recents.map(r => {
    const m = /^#\/c\/([^\/]+)\/process\/([^\/?]+)(?:\/(steps|metadata))?/.exec(r.hash || '');
    if (!m) return r;
    const [, rawColl, rawPid, tab] = m;
    const c = state.collections.find(x => x.id === decodeURIComponent(rawColl));
    if (!c) return r;
    const path = findPathToId(c, decodeURIComponent(rawPid));
    if (!path) return r;
    dirty = true;
    const view = tab === 'steps' ? 'steps' : undefined;
    return { ...r, hash: hashForNode(c.id, path, view ? { view } : {}) };
  });
  if (dirty) persistRecents();
}

function restoreLocalState() {
  try {
    const r = JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]');
    if (Array.isArray(r)) {
      state.recents = r
        .filter(x => x && typeof x.title === 'string' && typeof x.hash === 'string' && x.hash.startsWith('#/'))
        .slice(0, 8);
    }
  } catch { /* ignore */ }
  try {
    const arr = JSON.parse(localStorage.getItem(EXPANDED_KEY) || '[]');
    if (Array.isArray(arr)) state.expandedCollections = new Set(arr);
  } catch { /* ignore */ }
  try {
    const arr = JSON.parse(localStorage.getItem(EXPANDED_NODES_KEY) || '[]');
    if (Array.isArray(arr)) state.expandedNodes = new Set(arr);
  } catch { /* ignore */ }
  if (localStorage.getItem(SIDEBAR_KEY) === '1') {
    document.body.classList.add('sidebar-collapsed');
  }
  const savedWidth = parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) || '', 10);
  if (savedWidth >= SIDEBAR_MIN_WIDTH && savedWidth <= SIDEBAR_MAX_WIDTH) {
    document.body.style.setProperty('--sidebar-width', savedWidth + 'px');
  }
  const savedInspW = parseInt(localStorage.getItem(INSPECTOR_WIDTH_KEY) || '', 10);
  if (savedInspW >= INSPECTOR_MIN_WIDTH && savedInspW <= INSPECTOR_MAX_WIDTH) {
    document.body.style.setProperty('--inspector-width', savedInspW + 'px');
  }
  // Inspector: restore open + section only — never element (that requires
  // the viewer's live selection to be valid, and the viewer isn't up yet).
  // Legacy 'attributes' section value migrates to 'info' transparently.
  try {
    const raw = JSON.parse(localStorage.getItem(INSPECTOR_KEY) || 'null');
    if (raw && typeof raw === 'object') {
      if (typeof raw.open === 'boolean') state.inspector.open = raw.open;
      if (raw.section === 'info' || raw.section === 'comments') {
        state.inspector.section = raw.section;
      } else if (raw.section === 'attributes') {
        state.inspector.section = 'info';
      }
    }
  } catch { /* ignore */ }
}

function persistInspector() {
  try {
    localStorage.setItem(INSPECTOR_KEY, JSON.stringify({
      open: state.inspector.open,
      section: state.inspector.section
    }));
  } catch { /* ignore */ }
}

function persistRecents() {
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(state.recents)); } catch { /* ignore */ }
}

function persistExpanded() {
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...state.expandedCollections])); }
  catch { /* ignore */ }
}
function persistExpandedNodes() {
  try { localStorage.setItem(EXPANDED_NODES_KEY, JSON.stringify([...state.expandedNodes])); }
  catch { /* ignore */ }
}

// ─── Node-URL helpers ───────────────────────────────────────────────
// Build an href for a node identified by a path. Carries over the current
// session's ?view= when we're staying on the same collection so the user
// doesn't get snapped from Diagramm back to Tabelle on every tree click.
function nodeHrefFor(collId, path) {
  const r = state.route;
  const onSameColl = r.name === 'node' && r.collId === collId;
  const extras = {};
  if (onSameColl && r.view) extras.view = r.view;
  return hashForNode(collId, path, extras);
}

function collectionHrefFor(collId) {
  const r = state.route;
  const onSameColl = r.name === 'node' && r.collId === collId;
  const extras = {};
  if (onSameColl && r.view) extras.view = r.view;
  const base = hashForNode(collId, [], extras);
  const qs = onSameColl && (!r.path || r.path.length === 0) ? encodeNodeQuery(collId) : '';
  // hashForNode already produced "?view=..." — merge rather than double-?.
  if (!qs) return base;
  return base.includes('?') ? base + '&' + qs.slice(1) : base + qs;
}

// Encode filter/grouping state for persistence in the URL. Empty sets /
// default grouping render no parameter so the simple case stays a short URL.
function encodeNodeQuery(collId) {
  const f = state.filters[collId];
  if (!f) return '';
  const grouping = state.grouping[collId] || 'none';
  const parts = [];
  const push = (key, set) => {
    if (set && set.size) parts.push(`${key}=${[...set].map(encodeURIComponent).join(',')}`);
  };
  push('owners',   f.owners);
  push('statuses', f.statuses);
  if (grouping && grouping !== 'none') parts.push(`grouping=${encodeURIComponent(grouping)}`);
  return parts.length ? '?' + parts.join('&') : '';
}

// Inverse: pull owner/status/grouping state out of the route query so a
// shared URL reproduces the sender's filtered view.
function applyNodeRouteQueryToState(route) {
  if (route.name !== 'node') return;
  const f = state.filters[route.collId];
  if (!f) return;
  const q = route.query || {};
  const toSet = (v) => new Set((v || '').split(',').filter(Boolean));
  f.owners   = toSet(q.owners);
  f.statuses = toSet(q.statuses);
  state.grouping[route.collId] =
    /^(owner|status|none)$/.test(q.grouping || '') ? q.grouping : 'none';
}

// Push the current filter/grouping state into the URL (replace, not push).
function syncNodeUrl() {
  if (state.route.name !== 'node') return;
  const r = state.route;
  const extras = {};
  if (r.view) extras.view = r.view;
  if (r.selectedElementId) extras.el = r.selectedElementId;
  const base = hashForNode(r.collId, r.path || [], extras);
  const qs = encodeNodeQuery(r.collId);
  const target = qs
    ? (base.includes('?') ? base + '&' + qs.slice(1) : base + qs)
    : base;
  if (target !== window.location.hash) {
    history.replaceState(null, '', target);
    state.route = parseRoute();
  }
}

// Minimal structural check on the nested tree. Catches typos and truncated
// JSON; doesn't try to be zod. Returns true if the collection looks usable.
function validateCollection(data, expectedId) {
  const bad = (msg) => { console.warn(`[collection ${expectedId}] ${msg}`); return false; };
  if (!data || typeof data !== 'object') return bad('not an object');
  if (!Array.isArray(data.children))     return bad('children[] missing (tree root)');
  const validateNode = (n, trail) => {
    if (!n || typeof n !== 'object')    return bad(`${trail}: not an object`);
    if (typeof n.id !== 'string' || !n.id)   return bad(`${trail}: id missing`);
    if (typeof n.name !== 'string')     return bad(`${trail} (${n.id}): name missing`);
    if (n.children !== undefined && !Array.isArray(n.children))
      return bad(`${trail} (${n.id}): children must be an array if present`);
    for (const c of n.children || []) {
      if (!validateNode(c, `${trail}/${n.id}`)) return false;
    }
    return true;
  };
  for (const top of data.children) {
    if (!validateNode(top, 'root')) return false;
  }
  return true;
}

// ═══ Tree traversal helpers ═══════════════════════════════════════════

// Walk every node in the collection tree depth-first, yielding each node
// with its full path (array of IDs from root down to the node).
function walkTree(landscape, visit) {
  const rec = (node, path) => {
    visit(node, path);
    for (const c of node.children || []) rec(c, [...path, c.id]);
  };
  for (const top of landscape.children || []) rec(top, [top.id]);
}

// Resolve a path of IDs to its node + ancestor trail. Returns null if any
// segment doesn't match. Used by the router to turn URL path segments into
// the actual node + breadcrumb.
function findNodeByPath(c, idPath) {
  let cur = { children: c.landscape.children };
  const trail = [];
  for (const id of idPath) {
    const next = (cur.children || []).find(n => n.id === id);
    if (!next) return null;
    trail.push(next);
    cur = next;
  }
  return { node: cur, trail };
}

// Find the first node whose id matches, returning its path. Used to
// resolve legacy `/process/{id}` URLs into the new `/n/{l1}/{l2}/…` shape.
function findPathToId(c, id) {
  let out = null;
  walkTree(c.landscape, (node, path) => {
    if (!out && node.id === id) out = path;
  });
  return out;
}

// Predicate helpers that capture what each node "is".
function isContainerNode(node) { return !!(node?.children && node.children.length); }
function isProcessNode(node)   { return !!(node?.bpmn); }

// Flatten every descendant process (node with bpmn) under a subtree.
// Returns [{ node, path }] where path is the id trail from root.
function collectProcesses(landscape) {
  const out = [];
  walkTree(landscape, (node, path) => { if (isProcessNode(node)) out.push({ node, path }); });
  return out;
}

// Flatten every Level-2+ node (=everything that isn't a Level-1 container) —
// this is what the app has historically meant by "process" for KPI counts
// and the flat table view.
function collectLeaves(landscape) {
  const out = [];
  walkTree(landscape, (node, path) => {
    // A node is a "leaf" for the table view if it's at Level 2+ AND either
    // has bpmn OR has no further children. Level-1 containers are excluded.
    if (path.length >= 2 && (!isContainerNode(node) || isProcessNode(node))) {
      out.push({ node, path });
    }
  });
  return out;
}

// Build the canonical hash URL for a node at `path` inside `c`.
// Omits `/n/` entirely when path is empty (collection root).
function hashForNode(collId, path, { view, el } = {}) {
  const base = `#/c/${encodeURIComponent(collId)}`
             + (path.length ? '/n/' + path.map(encodeURIComponent).join('/') : '');
  const qs = [];
  if (view) qs.push(`view=${encodeURIComponent(view)}`);
  if (el)   qs.push(`el=${encodeURIComponent(el)}`);
  return base + (qs.length ? '?' + qs.join('&') : '');
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
  const qSplit = hash.indexOf('?');
  const pathPart = qSplit >= 0 ? hash.slice(0, qSplit) : hash;
  const queryStr = qSplit >= 0 ? hash.slice(qSplit + 1) : '';
  const parts = pathPart.replace(/^#\/?/, '').split('/').filter(Boolean);
  // Query-string parse (used by several branches below).
  const query = {};
  for (const kv of queryStr.split('&').filter(Boolean)) {
    const eq = kv.indexOf('=');
    const k = eq >= 0 ? kv.slice(0, eq) : kv;
    const v = eq >= 0 ? decodeURIComponent(kv.slice(eq + 1)) : '';
    query[k] = v;
  }

  if (parts.length === 0) return { name: 'home' };
  if (parts[0] === 'search') {
    return { name: 'search', q: (query.q || '').replace(/\+/g, ' ') };
  }
  if (parts[0] === 'chat') return { name: 'chat' };
  if (parts[0] === 'workflows') return { name: 'workflows' };
  if (parts[0] === 'recents') return { name: 'recents' };

  if (parts[0] === 'c' && parts[1]) {
    const collId = decodeURIComponent(parts[1]);
    // Legacy /process/{id}[/steps|/metadata] shape — preserve `legacyProcessId`
    // so handleRoute can look up the node in the tree and redirect.
    if (parts[2] === 'process' && parts[3]) {
      const rawTab = parts[4];
      return {
        name: 'node',
        legacy: 'process',
        collId,
        legacyProcessId: decodeURIComponent(parts[3]),
        legacyTab: (rawTab === 'metadata' || rawTab === 'steps') ? rawTab : 'diagram',
        query
      };
    }
    // Legacy /diagram | /metadata | /table bare suffixes on collection root.
    if (parts[2] === 'diagram' || parts[2] === 'metadata' || parts[2] === 'table') {
      return {
        name: 'node',
        legacy: 'collection',
        collId,
        legacyView: parts[2],
        query
      };
    }
    // New shape: /c/{coll}/n/{id1}/{id2}/…  (path empty = collection root)
    let path = [];
    if (parts[2] === 'n') {
      path = parts.slice(3).map(decodeURIComponent);
    }
    // view is always in the query string in the new shape. Legal values:
    // table / diagram / steps. Anything else treated as "unset" (let the
    // renderer pick a sensible default based on the node's shape).
    const rawView = query.view || '';
    const view = ['table', 'diagram', 'steps'].includes(rawView) ? rawView : '';
    return {
      name: 'node',
      collId,
      path,
      view,
      selectedElementId: query.el || '',
      query
    };
  }
  return { name: 'home' };
}

function handleRoute() {
  state.route = parseRoute();

  // Legacy-URL redirects: rewrite in-place then re-parse so the rest of
  // the function uses the canonical new shape.
  if (state.route.name === 'node' && state.route.legacy) {
    migrateLegacyRoute(state.route);
    return;  // migrateLegacyRoute calls handleRoute recursively after rewriting
  }

  state.filterPanelOpen = false;
  hideSearchDropdown();
  syncHeaderSearch(state.route.name === 'search' ? (state.route.q || '') : '');

  // Route-scoped body class. For node routes, folds in view+depth so CSS can
  // key off e.g. `body.route-node-process-diagram` or `route-node-container`.
  const r = state.route;
  let routeClass = `route-${r.name}`;
  if (r.name === 'node') {
    const resolved = resolveNodeRoute(r);
    if (resolved) {
      const mode = isProcessNode(resolved.node) ? 'process' : 'container';
      const v = effectiveView(resolved.node, r.view);
      routeClass = `route-node-${mode}-${v}`;
    }
  }
  document.body.className = document.body.className
    .split(/\s+/).filter(c => !c.startsWith('route-')).concat(routeClass).join(' ').trim();

  // Destroy the BPMN viewer whenever we're not on a process-diagram route.
  const resolvedForViewer = r.name === 'node' ? resolveNodeRoute(r) : null;
  const keepViewer = !!(
    resolvedForViewer &&
    isProcessNode(resolvedForViewer.node) &&
    effectiveView(resolvedForViewer.node, r.view) === 'diagram'
  );
  if (state.bpmnViewer && !keepViewer) {
    state.bpmnViewer.destroy();
    state.bpmnViewer = null;
  }
  if (!keepViewer) state.inspector.element = null;

  renderSidebar();
  const main = document.getElementById('main-content');
  switch (state.route.name) {
    case 'home':       main.innerHTML = renderHome(); break;
    case 'search':     main.innerHTML = renderSearchResults(state.route.q || ''); break;
    case 'chat':       main.innerHTML = renderChatView(); break;
    case 'workflows':  main.innerHTML = renderWorkflowsView(); break;
    case 'recents':    main.innerHTML = renderRecents(); break;
    case 'node':       renderNodeRoute(state.route); break;
  }

  lucide.createIcons();
  main.focus({ preventScroll: true });
  announceRoute();
  refreshInspector();
}

// Resolve a node route to its collection + node + trail. Returns null when
// the collection or the path is unknown — caller is expected to render a
// "not found" page in that case.
function resolveNodeRoute(route) {
  const c = state.collections.find(x => x.id === route.collId);
  if (!c) return null;
  if (!route.path || route.path.length === 0) {
    // Collection root: the collection itself is the "node".
    return { c, node: { id: c.id, name: c.name, children: c.landscape.children }, trail: [] };
  }
  const hit = findNodeByPath(c, route.path);
  if (!hit) return null;
  return { c, node: hit.node, trail: hit.trail };
}

// Given a node + the raw ?view value, pick a sensible view. Containers
// default to 'table'; process nodes default to 'diagram'. 'steps' is only
// valid for process nodes.
function effectiveView(node, rawView) {
  const isProc = isProcessNode(node);
  if (isProc) {
    if (rawView === 'steps' || rawView === 'diagram') return rawView;
    return 'diagram';
  }
  if (rawView === 'diagram' || rawView === 'table') return rawView;
  return 'table';
}

// Turn a legacy URL (/process/{id} or /c/{id}/diagram etc.) into the new
// canonical hash + re-handle. Preserves `?el=` and tab intent.
function migrateLegacyRoute(route) {
  const c = state.collections.find(x => x.id === route.collId);
  if (!c) {
    // Unknown collection — strip the legacy tail and go to home.
    history.replaceState(null, '', '#/');
    return handleRoute();
  }
  let target = null;
  if (route.legacy === 'process') {
    const path = findPathToId(c, route.legacyProcessId);
    if (path) {
      const extras = {};
      if (route.legacyTab === 'steps') extras.view = 'steps';   // 'diagram' is default, omit
      if (route.query?.el) extras.el = route.query.el;
      target = hashForNode(c.id, path, extras);
      if (route.legacyTab === 'metadata') {
        // Surface metadata via the inspector (same rule as before).
        state.inspector.open = true;
        state.inspector.section = 'info';
        persistInspector();
      }
    } else {
      // Process id not found in the new tree — fall back to collection root.
      target = hashForNode(c.id, []);
    }
  } else if (route.legacy === 'collection') {
    if (route.legacyView === 'metadata') {
      state.inspector.open = true;
      state.inspector.section = 'info';
      persistInspector();
      target = hashForNode(c.id, []);
    } else {
      const extras = {};
      if (route.legacyView === 'diagram') extras.view = 'diagram'; // 'table' default
      target = hashForNode(c.id, [], extras);
    }
  }
  if (target && target !== window.location.hash) {
    history.replaceState(null, '', target);
  }
  handleRoute();
}

// Dispatch render for a resolved node route. Container nodes (collection,
// Level 1, or Level 2-with-children) get the landing view; process nodes
// (anything with bpmn) get the Diagramm/Schritte view.
function renderNodeRoute(route) {
  const resolved = resolveNodeRoute(route);
  if (!resolved) {
    document.getElementById('main-content').innerHTML =
      `<div class="content-wrapper"><p>Inhalt nicht gefunden.</p></div>`;
    return;
  }
  const { c, node, trail } = resolved;
  const view = effectiveView(node, route.view);
  applyNodeRouteQueryToState(route);  // restores filter/grouping state from URL

  if (isProcessNode(node)) {
    renderProcess(c, node, trail, view);
  } else {
    document.getElementById('main-content').innerHTML = renderContainer(c, node, trail, view);
  }
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
  wireInspectorResize();

  // Inspector — new-comment form submission (delegated).
  document.addEventListener('submit', (e) => {
    if (e.target?.id !== 'inspector-comment-form') return;
    e.preventDefault();
    const input = document.getElementById('inspector-comment-input');
    const text = (input?.value || '').trim();
    if (!text) return;
    addCommentForCurrent(state.inspector.element, text);
    if (input) input.value = '';
    refreshInspector();
  });

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

    // ── Title-block action icons (info / comments / edit / print / share) ──
    const inspectorToggle = e.target.closest('[data-inspector-toggle]');
    if (inspectorToggle) {
      toggleInspector(inspectorToggle.dataset.inspectorToggle);
      return;
    }
    const actionBtn = e.target.closest('.title-block-action-btn[data-action]');
    if (actionBtn) {
      const action = actionBtn.dataset.action;
      if (action === 'edit') {
        // No editing affordance yet — honest "coming soon" beats a silent no-op.
        showToast('Bearbeiten noch nicht verfügbar.');
      } else if (action === 'more') {
        // Kebab dropdown toggles the same menu state as the old export button.
        state.exportMenuOpen = !state.exportMenuOpen;
        state.groupingMenuOpen = false;
        document.getElementById('titleblock-more-menu')?.classList.toggle('open', state.exportMenuOpen);
        document.getElementById('grouping-menu')?.classList.remove('open');
        actionBtn.setAttribute('aria-expanded', String(state.exportMenuOpen));
        return;
      } else if (action === 'print') {
        window.print();
      } else if (action === 'share') {
        shareCurrentPage();
      }
      return;
    }

    // ── Inspector panel internals (close, tab switch, add/delete comment) ──
    if (e.target.closest('#inspector-close')) {
      closeInspector();
      return;
    }
    const inspectorTab = e.target.closest('[data-inspector-section]');
    if (inspectorTab) {
      state.inspector.section = inspectorTab.dataset.inspectorSection;
      persistInspector();
      refreshInspector();
      return;
    }
    const delBtn = e.target.closest('[data-comment-del]');
    if (delBtn) {
      deleteCommentForCurrent(state.inspector.element, delBtn.dataset.commentDel);
      refreshInspector();
      return;
    }

    // ── Schritte table row → select the step in the inspector ──
    const stepRow = e.target.closest('[data-step-id]');
    if (stepRow) {
      const id = stepRow.dataset.stepId;
      const steps = state.processSteps || [];
      const info = steps.find(s => s.id === id);
      if (info) {
        setInspectorElement(info);
        // Reflect the selection on the row itself without a full rerender.
        stepRow.parentElement?.querySelectorAll('.is-selected')
          .forEach(el => el.classList.remove('is-selected'));
        stepRow.classList.add('is-selected');
      }
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
    // Node chevron toggle (L1/L2 in the recursive tree). Same idiom.
    const nodeToggle = e.target.closest('[data-toggle-node]');
    if (nodeToggle) {
      e.preventDefault();
      e.stopPropagation();
      const key = nodeToggle.dataset.toggleNode;
      if (state.expandedNodes.has(key)) state.expandedNodes.delete(key);
      else state.expandedNodes.add(key);
      persistExpandedNodes();
      renderSidebar();
      if (window.lucide?.createIcons) window.lucide.createIcons();
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
        owners: new Set(), statuses: new Set()
      };
      rerenderCollection(); return;
    }

    // Grouping dropdown
    if (e.target.closest('#grouping-btn')) {
      state.groupingMenuOpen = !state.groupingMenuOpen;
      state.exportMenuOpen = false;
      document.getElementById('grouping-menu')?.classList.toggle('open', state.groupingMenuOpen);
      document.getElementById('titleblock-more-menu')?.classList.remove('open');
      return;
    }
    const gOpt = e.target.closest('.grouping-option[data-grouping]');
    if (gOpt) {
      state.grouping[state.route.collId] = gOpt.dataset.grouping;
      state.groupingMenuOpen = false;
      rerenderCollection(); return;
    }

    // Workflows view: per-collection export buttons.
    const collExportBtn = e.target.closest('[data-export-coll]');
    if (collExportBtn) {
      const [collId, kind] = collExportBtn.dataset.exportColl.split(':');
      const c = state.collections.find(x => x.id === collId);
      if (!c) return;
      const rootNode = { id: c.id, name: c.name, children: c.landscape.children };
      const rows = collectRowsUnder(c, rootNode, []);
      if (kind === 'excel')      exportContainerExcel(c, rootNode, rows);
      else if (kind === 'pdf')   exportContainerPdf(c, rootNode, rows);
      else if (kind === 'bpmn')  downloadContainerBpmnZip(c, rootNode, rows);
      return;
    }

    // Export option selected from the title-block kebab menu.
    const xOpt = e.target.closest('.grouping-option[data-export]');
    if (xOpt) {
      if (xOpt.classList.contains('disabled')) return;
      state.exportMenuOpen = false;
      document.getElementById('titleblock-more-menu')?.classList.remove('open');
      dispatchExport(xOpt.dataset.export);
      return;
    }

    // Click outside any open dropdown → close all. Kebab lives in
    // .title-block-more-wrap, grouping lives in .grouping-dropdown.
    if ((state.groupingMenuOpen || state.exportMenuOpen) &&
        !e.target.closest('.grouping-dropdown, .title-block-more-wrap')) {
      state.groupingMenuOpen = false;
      state.exportMenuOpen = false;
      document.getElementById('grouping-menu')?.classList.remove('open');
      document.getElementById('titleblock-more-menu')?.classList.remove('open');
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

// Mirror of wireSidebarResize for the right-side inspector panel. Dragging
// the handle left widens the panel (and shrinks main-content via the
// body.inspector-open rule); dragging right narrows it. Double-click resets.
function wireInspectorResize() {
  const handle = document.getElementById('inspector-resize-handle');
  if (!handle) return;
  let startX = 0, startWidth = 0;

  const onMove = (e) => {
    const delta = startX - e.clientX;  // drag LEFT → wider; drag RIGHT → narrower
    const w = Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, startWidth + delta));
    document.body.style.setProperty('--inspector-width', w + 'px');
  };
  const onUp = () => {
    document.body.classList.remove('inspector-resizing');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    const panel = document.getElementById('inspector-panel');
    if (panel) {
      try { localStorage.setItem(INSPECTOR_WIDTH_KEY, String(panel.offsetWidth)); }
      catch { /* ignore */ }
    }
  };

  handle.addEventListener('mousedown', (e) => {
    if (!document.body.classList.contains('inspector-open')) return;
    e.preventDefault();
    startX = e.clientX;
    startWidth = document.getElementById('inspector-panel')?.offsetWidth || 340;
    document.body.classList.add('inspector-resizing');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  handle.addEventListener('dblclick', () => {
    document.body.style.removeProperty('--inspector-width');
    try { localStorage.removeItem(INSPECTOR_WIDTH_KEY); } catch { /* ignore */ }
  });
}

// ─── Inspector panel ────────────────────────────────────────────────
// Rendering, open/close, and bpmn-js selection binding. The panel is only
// meaningful on the process view — handleRoute() closes it otherwise.

function inspectorIsRelevantRoute() {
  return state.route.name === 'node';
}

function refreshInspector() {
  const panel = document.getElementById('inspector-panel');
  if (!panel) return;
  const open = !!state.inspector.open && inspectorIsRelevantRoute();
  panel.hidden = !open;
  document.body.classList.toggle('inspector-open', open);
  if (open) {
    panel.innerHTML = renderInspector();
    if (window.lucide?.createIcons) window.lucide.createIcons();
  } else {
    panel.innerHTML = '';
  }
  // Title-block action icons reflect the current open section.
  document.querySelectorAll('[data-inspector-toggle]').forEach(btn => {
    const active = state.inspector.open && btn.dataset.inspectorToggle === state.inspector.section;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

function openInspector(section) {
  state.inspector.open = true;
  if (section) state.inspector.section = section;
  persistInspector();
  refreshInspector();
}
function closeInspector() {
  state.inspector.open = false;
  persistInspector();
  refreshInspector();
}
function toggleInspector(section) {
  if (state.inspector.open && state.inspector.section === section) {
    closeInspector();
  } else {
    openInspector(section);
  }
}

// Called by bpmn.js (diagram click) and views.js (steps-table row click)
// to change the element whose attributes the inspector shows. Also mirrors
// the id into the URL so the selection survives reload + tab switch.
function setInspectorElement(info) {
  state.inspector.element = info || null;
  // Auto-open on first click so users discover the panel.
  if (info && !state.inspector.open) {
    state.inspector.open = true;
    state.inspector.section = 'info';
    persistInspector();
  }
  syncSelectedElementUrl();
  refreshInspector();
}

// Rewrite `?el=<id>` on the current node URL to match state.inspector.element.
// Uses replaceState so the back-button still navigates between processes, not
// between individual shape clicks.
function syncSelectedElementUrl() {
  if (state.route.name !== 'node') return;
  const desired = state.inspector.element?.id || '';
  const current = state.route.selectedElementId || '';
  if (desired === current) return;
  const r = state.route;
  const target = hashForNode(r.collId, r.path || [], {
    view: r.view,
    el: desired
  });
  if (target !== window.location.hash) {
    history.replaceState(null, '', target);
    state.route.selectedElementId = desired;
  }
  // Keep the two process-tab buttons' data-nav in sync with the current
  // selection — otherwise clicking Diagramm/Schritte after selecting a
  // step navigates to the stale (no-?el) URL baked in at render time.
  document.querySelectorAll('[data-process-tab]').forEach(btn => {
    const t = btn.dataset.processTab;   // "diagram" | "steps"
    // Diagram is the default view for process nodes — omit ?view=diagram.
    const extras = desired ? { el: desired } : {};
    if (t === 'steps') extras.view = 'steps';
    btn.dataset.nav = hashForNode(r.collId, r.path || [], extras);
  });
}

// ─── Comments storage (localStorage) ────────────────────────────────
// Shape on disk — scope key encodes the full node path so Level-2 and
// Level-3 comments don't collide:
//   node + element: "<collId>|<id1>|<id2>|…::<elementId>"
//   node-level:     "<collId>|<id1>|<id2>|…"
//   collection root: "<collId>"
function commentScopeKey(el) {
  const r = state.route;
  if (r.name !== 'node') return null;
  const base = [r.collId, ...(r.path || [])].join('|');
  if (el && el.id) return `${base}::${el.id}`;
  return base;
}

function readCommentsMap() {
  try {
    const obj = JSON.parse(localStorage.getItem(COMMENTS_KEY) || '{}');
    return (obj && typeof obj === 'object') ? obj : {};
  } catch { return {}; }
}
function writeCommentsMap(obj) {
  try { localStorage.setItem(COMMENTS_KEY, JSON.stringify(obj)); } catch { /* ignore */ }
}
function getCommentsForCurrent(el) {
  const key = commentScopeKey(el);
  if (!key) return [];
  const all = readCommentsMap();
  return Array.isArray(all[key]) ? all[key] : [];
}
function addCommentForCurrent(el, text) {
  const key = commentScopeKey(el);
  if (!key) return;
  const all = readCommentsMap();
  const list = Array.isArray(all[key]) ? all[key] : [];
  list.unshift({
    id: 'c_' + Math.random().toString(36).slice(2, 10),
    author: 'DR',  // placeholder author — matches header avatar
    text: String(text).trim(),
    createdAt: new Date().toISOString()
  });
  all[key] = list;
  writeCommentsMap(all);
}
function deleteCommentForCurrent(el, commentId) {
  const key = commentScopeKey(el);
  if (!key) return;
  const all = readCommentsMap();
  if (!Array.isArray(all[key])) return;
  all[key] = all[key].filter(c => c.id !== commentId);
  writeCommentsMap(all);
}

// ─── Sharing ────────────────────────────────────────────────────────
// Prefer the Web Share API (opens the OS share sheet on Win/Mac/mobile);
// fall back to a clipboard copy when it's absent or refused by the browser.
function shareCurrentPage() {
  const url = window.location.href;
  const title = getShareTitle();
  if (navigator.share) {
    navigator.share({ title, text: title, url }).catch(err => {
      // User cancelled the share picker — silent, no fallback needed.
      if (err?.name === 'AbortError') return;
      // Insecure-context or policy refusal (e.g. NotAllowedError on http://
      // hosts in some browsers) — still give the user a usable link.
      copyUrlToClipboard(url);
    });
    return;
  }
  copyUrlToClipboard(url);
}

function getShareTitle() {
  const r = state.route;
  if (r.name === 'node') {
    const resolved = resolveNodeRoute(r);
    if (resolved) {
      const { c, node, trail } = resolved;
      if (trail.length === 0) return c.name;
      return `${node.id} ${node.name} — ${c.name}`;
    }
  }
  return document.title || 'Process Hub';
}

function copyUrlToClipboard(url) {
  const ok = () => showToast('Link in Zwischenablage kopiert.');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(ok, () => showToast('Kopieren fehlgeschlagen.'));
    return;
  }
  // execCommand('copy') path for ancient browsers without the Async API.
  const ta = document.createElement('textarea');
  ta.value = url;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); ok(); }
  catch { showToast('Kopieren fehlgeschlagen.'); }
  ta.remove();
}

// ─── Toast ──────────────────────────────────────────────────────────
function showToast(text, ms = 2200) {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  region.appendChild(el);
  setTimeout(() => { el.remove(); }, ms);
}

// Renamed from rerenderCollection. Re-draws the current node view after a
// filter / grouping / view change. Also pushes state into the URL via
// syncNodeUrl so shared links reproduce the same filtered view.
function rerenderNode() {
  if (state.route.name !== 'node') return;
  syncNodeUrl();
  const resolved = resolveNodeRoute(state.route);
  if (!resolved) return;
  if (isProcessNode(resolved.node)) return;  // process views are self-managed
  const view = effectiveView(resolved.node, state.route.view);
  document.getElementById('main-content').innerHTML =
    renderContainer(resolved.c, resolved.node, resolved.trail, view);
  lucide.createIcons();
  refreshInspector();
}
// Back-compat alias so existing click handlers keep working verbatim.
const rerenderCollection = rerenderNode;

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

  // Collect the current route's full path (coll + trail ids) as a set of
  // stringified keys so child rows know which ancestor to render as active.
  const currentPathKey = r.name === 'node'
    ? [r.collId, ...(r.path || [])].join('|')
    : '';

  for (const c of state.collections) {
    const onThis = r.name === 'node' && r.collId === c.id;
    // Auto-expand once on first entry so users discover child processes —
    // but never again, so manual collapse sticks even while inside.
    if (onThis && !state.autoExpandedCollections.has(c.id)) {
      state.expandedCollections.add(c.id);
      state.autoExpandedCollections.add(c.id);
    }
    const expanded = state.expandedCollections.has(c.id);
    const count = totalProcesses(c.landscape);
    // Collection row is "active" only when we're on the collection root;
    // it's "on-path" whenever we're deeper inside the collection.
    const rowActive = onThis && (!r.path || r.path.length === 0);
    const rowOnPath = onThis && !rowActive;
    const collLabel = c.code
      ? `<code class="nav-child-id">${escapeHtml(c.code)}</code> <span>${escapeHtml(c.name)}</span>`
      : `<span>${escapeHtml(c.name)}</span>`;
    const collClasses = [
      'nav-item', 'nav-item-branch', 'nav-item-collection',
      rowActive ? 'active' : '',
      rowOnPath ? 'on-path' : ''
    ].filter(Boolean).join(' ');

    html += `
      <div class="${collClasses}" data-nav="${collectionHrefFor(c.id)}"
           role="link" title="${escapeAttr((c.code ? c.code + ' ' : '') + c.name)}">
        <button type="button" class="nav-chevron sidebar-collapsed-hide" data-toggle-collection="${escapeAttr(c.id)}"
                aria-expanded="${expanded}" aria-label="${expanded ? 'Einklappen' : 'Ausklappen'}">
          <i data-lucide="chevron-${expanded ? 'down' : 'right'}" style="width:12px;height:12px;"></i>
        </button>
        <i data-lucide="folder-tree" class="nav-item-icon-compact" style="width:16px;height:16px;flex-shrink:0;"></i>
        ${collLabel}
        <span class="nav-count">${count}</span>
      </div>`;

    if (expanded) {
      html += renderSidebarNodes(c, c.landscape.children || [], [], currentPathKey);
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

// Recursive sidebar sub-tree. Every row is flush-left (no per-depth indent);
// hierarchy is conveyed by the id itself (TQ.21.00 vs TQ.21.00.00.02) + the
// chevron/leaf distinction. State language: hover, on-path (ancestor of the
// active node), active (the current node). All three use a left-edge accent
// bar for a consistent catalog-tree look.
function renderSidebarNodes(c, nodes, parentPath, currentPathKey) {
  if (!nodes || nodes.length === 0) return '';
  // Natural sort so TQ.21.00.00.02 < TQ.21.00.00.15 and "1" < "2" < "10".
  const sorted = [...nodes].sort(
    (x, y) => x.id.localeCompare(y.id, undefined, { numeric: true })
  );
  let out = '';
  for (const n of sorted) {
    const pathIds = [...parentPath, n.id];
    const key = [c.id, ...pathIds].join('|');
    const hasChildren = isContainerNode(n);
    const expanded = state.expandedNodes.has(key);
    const active = currentPathKey === key;
    // onPath: this node is an ancestor of the currently-active node.
    const onPath = currentPathKey.startsWith(key + '|');
    const href = nodeHrefFor(c.id, pathIds);
    const chevron = hasChildren
      ? `<button type="button" class="nav-chevron sidebar-collapsed-hide" data-toggle-node="${escapeAttr(key)}"
                 aria-expanded="${expanded}" aria-label="${expanded ? 'Einklappen' : 'Ausklappen'}">
           <i data-lucide="chevron-${expanded ? 'down' : 'right'}" style="width:12px;height:12px;"></i>
         </button>`
      : `<span class="nav-chevron-spacer sidebar-collapsed-hide" aria-hidden="true"></span>`;
    const countBadge = hasChildren
      ? `<span class="nav-count">${countDescendantProcesses(n)}</span>`
      : '';
    const classes = [
      'nav-item', 'nav-item-child', 'sidebar-collapsed-hide',
      active ? 'active' : '',
      onPath && !active ? 'on-path' : '',
      hasChildren ? 'nav-item-branch' : 'nav-item-leaf'
    ].filter(Boolean).join(' ');
    out += `
      <div class="${classes}"
           data-nav="${escapeAttr(href)}"
           role="link" title="${escapeAttr(n.id + ' ' + n.name)}">
        ${chevron}
        <code class="nav-child-id">${escapeHtml(n.id)}</code>
        <span>${escapeHtml(n.name)}</span>
        ${countBadge}
      </div>`;
    if (hasChildren && expanded) {
      out += renderSidebarNodes(c, n.children, pathIds, currentPathKey);
    }
  }
  return out;
}

// ─── KPI helpers ────────────────────────────────────────────────────
// "Prozesse" = every Level-2+ node (descendants of Level-1). Level-1
// containers are excluded so a collection with one L1 + 18 L2s reports 18.
function totalProcesses(landscape) {
  let n = 0;
  walkTree(landscape, (_, path) => { if (path.length >= 2) n++; });
  return n;
}
function processesWithBpmn(landscape) {
  let n = 0;
  walkTree(landscape, (node) => { if (isProcessNode(node)) n++; });
  return n;
}
function countLevel1(landscape) { return (landscape.children || []).length; }

// Descendant count for a node — used by the sidebar count badges. Semantics
// match totalProcesses (every Level-2+ descendant, i.e. everything below
// Level-1 containers). For L1, that's the count of its L2 children (and L3
// if present); for L2 containers, that's the L3 count; for leaves, 0.
function countDescendantProcesses(node) {
  let n = 0;
  const rec = (p) => {
    for (const c of p.children || []) {
      n++;
      rec(c);
    }
  };
  rec(node);
  return n;
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
