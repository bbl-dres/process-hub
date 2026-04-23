// bpmn.js - BPMN-js viewer glue + step parsing. Everything that
// fetches, renders, or parses BPMN XML lives here.

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
    // Stash for the row-click delegated handler in app.js.
    state.processSteps = steps;
    container.innerHTML = renderStepsTable(steps);
    // If the URL carries ?el=<id>, pre-select that row + inspector.
    const preId = state.route.selectedElementId;
    if (preId) {
      const hit = steps.find(s => s.id === preId);
      if (hit && typeof setInspectorElement === 'function') setInspectorElement(hit);
    }
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

  // Count incoming/outgoing sequence flows per node id. Needed so a row
  // click in the Schritte table yields the same attribute payload as a
  // shape click in the diagram (where bpmn-js hands us in/out arrays).
  const inCount = new Map(), outCount = new Map();
  for (const flow of doc.getElementsByTagNameNS(BPMN_NS, 'sequenceFlow')) {
    const src = flow.getAttribute('sourceRef');
    const tgt = flow.getAttribute('targetRef');
    if (src) outCount.set(src, (outCount.get(src) || 0) + 1);
    if (tgt) inCount.set(tgt,  (inCount.get(tgt)  || 0) + 1);
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
    const id = n.getAttribute('id') || '';
    // Pull <bpmn:documentation> text children, same as describeBpmnElement.
    let documentation = '';
    for (const d of n.getElementsByTagNameNS(BPMN_NS, 'documentation')) {
      const t = (d.textContent || '').trim();
      if (t) documentation = documentation ? documentation + '\n' + t : t;
    }
    return {
      id,
      name: n.getAttribute('name') || '',
      type: 'bpmn:' + (n.localName.charAt(0).toUpperCase() + n.localName.slice(1)),
      typeLabel: meta?.label || n.localName,
      kind: meta?.kind || 'other',
      lane: laneMap.get(id) || '',
      incoming: inCount.get(id) || 0,
      outgoing: outCount.get(id) || 0,
      documentation
    };
  });
}

function renderStepsTable(steps) {
  if (steps.length === 0) {
    return `<div class="empty-state">Keine Schritte im BPMN-Modell gefunden.</div>`;
  }
  const selectedId = state.route.selectedElementId || '';
  return `
    <div class="data-table-wrap">
      <table class="data-table">
        <colgroup>
          <col style="width: 60px;">
          <col style="width: var(--col-primary);">
          <col style="width: var(--col-area);">
          <col style="width: var(--col-person);">
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
            <tr class="clickable-row ${s.id === selectedId ? 'is-selected' : ''}" data-step-id="${escapeAttr(s.id)}">
              <td style="font-variant-numeric: tabular-nums; color: var(--color-text-secondary);">${i + 1}</td>
              <td>${s.name ? escapeHtml(s.name) : '<span class="text-placeholder">(ohne Namen)</span>'}</td>
              <td>${escapeHtml(s.typeLabel)}</td>
              <td>${s.lane ? escapeHtml(s.lane) : '<span class="text-placeholder">—</span>'}</td>
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
    state.bpmnLastXml = xml;
    state.bpmnMarkedId = null;  // old id belongs to the previous viewer's DOM, which is gone
    canvasEl.innerHTML = '';
    if (!window.BpmnJS) throw new Error('BPMN-Viewer nicht geladen');
    // NavigatedViewer enables mouse pan + wheel zoom out of the box.
    state.bpmnViewer = new window.BpmnJS({ container: canvasEl });
    const { warnings } = await state.bpmnViewer.importXML(xml);
    if (warnings?.length) console.warn('BPMN import warnings:', warnings);
    state.bpmnViewer.get('canvas').zoom('fit-viewport', 'auto');
    wireBpmnToolbar();
    wireBpmnSelection(xml);
    applyRouteSelection();
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
  // Attach the document-level fullscreenchange listener EXACTLY ONCE per
  // page load. Earlier iterations re-attached it on every process view,
  // accumulating one listener per navigation. We flag it with a module
  // variable instead of calling addEventListener repeatedly.
  if (!wireBpmnToolbar._fullscreenBound) {
    document.addEventListener('fullscreenchange', onFullscreenChange);
    wireBpmnToolbar._fullscreenBound = true;
  }

  // Disable bpmn-js built-in scroll-to-pan and replace with scroll-to-zoom.
  // The default in NavigatedViewer is: plain wheel pans, Ctrl+wheel zooms —
  // we invert that so the wheel always zooms, cursor-anchored.
  try { state.bpmnViewer.get('zoomScroll').toggle(false); } catch { /* module missing */ }
  if (canvasEl && !canvasEl._zoomHandlerAttached) {
    canvasEl.addEventListener('wheel', onBpmnWheel, { passive: false });
    canvasEl._zoomHandlerAttached = true;
  }
}

// Bind element.click on the bpmn-js eventBus so clicking a shape pushes
// its structured info into the inspector. We also pre-build a lane map
// from the raw XML so lane resolution doesn't depend on bpmn-js internals.
// Pre-select the element named in state.route.selectedElementId (from ?el=…).
// Looks it up via elementRegistry (always available), applies a visible
// marker via canvas.addMarker (NavigatedViewer has no 'selection' service,
// which is Modeler-only — earlier attempts to grab it made the whole fn
// early-return and nothing filled the panel), scrolls into view, and pushes
// the described form into the inspector. Silently clears a stale ?el.
function applyRouteSelection() {
  const id = state.route.selectedElementId;
  if (!id || !state.bpmnViewer) return;
  let registry, canvas;
  try {
    registry = state.bpmnViewer.get('elementRegistry');
    canvas   = state.bpmnViewer.get('canvas');
  } catch { return; }
  const el = registry.get(id);
  if (!el) {
    if (typeof setInspectorElement === 'function') setInspectorElement(null);
    return;
  }
  // Selection service only exists in Modeler; fall back to our custom
  // marker for NavigatedViewer (the path the prototype uses).
  try { state.bpmnViewer.get('selection').select(el); } catch { markBpmnElement(id); }
  try { canvas.scrollToElement(el); } catch { /* older bpmn-js lacks this */ }
  if (typeof setInspectorElement === 'function') {
    const xml = state.bpmnLastXml || '';
    const info = describeBpmnElement(el, buildLaneMap(xml));
    setInspectorElement(info);
  }
}

function wireBpmnSelection(xml) {
  if (!state.bpmnViewer) return;
  const laneMap = buildLaneMap(xml);
  const bus = state.bpmnViewer.get('eventBus');
  bus.on('element.click', (evt) => {
    const el = evt?.element;
    if (!el || el.type === 'bpmn:Process' || el.type === 'bpmn:Collaboration') {
      // Empty-canvas / root click → clear selection + marker.
      markBpmnElement(null);
      if (typeof setInspectorElement === 'function') setInspectorElement(null);
      return;
    }
    markBpmnElement(el.id);
    const info = describeBpmnElement(el, laneMap);
    if (typeof setInspectorElement === 'function') setInspectorElement(info);
  });
}

// Visible selection marker. NavigatedViewer has no 'selection' service, so
// clicks don't draw any outline by default. We roll our own via canvas
// markers — CSS (.ph-selected-shape) paints the highlight.
function markBpmnElement(id) {
  if (!state.bpmnViewer) return;
  let canvas;
  try { canvas = state.bpmnViewer.get('canvas'); } catch { return; }
  const prev = state.bpmnMarkedId;
  if (prev && prev !== id) {
    try { canvas.removeMarker(prev, 'ph-selected-shape'); } catch { /* ignore */ }
  }
  if (id) {
    try { canvas.addMarker(id, 'ph-selected-shape'); } catch { /* ignore */ }
  }
  state.bpmnMarkedId = id || null;
}

function buildLaneMap(xml) {
  const map = new Map();
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    for (const lane of doc.getElementsByTagNameNS(BPMN_NS, 'lane')) {
      const laneName = lane.getAttribute('name') || '';
      for (const ref of lane.getElementsByTagNameNS(BPMN_NS, 'flowNodeRef')) {
        map.set(ref.textContent.trim(), laneName);
      }
    }
  } catch { /* ignore — lane info is best-effort */ }
  return map;
}

// Build the object shape the inspector consumes. Extracts the type label
// from the STEP_TYPES table so Aufgabe / XOR-Gateway / etc. match the
// Schritte-tab vocabulary.
function describeBpmnElement(el, laneMap) {
  const bo = el.businessObject || {};
  // el.type is "bpmn:UserTask" etc. — strip the prefix to look up in STEP_TYPES.
  const localName = (el.type || '').replace(/^bpmn:/, '');
  const localLower = localName.charAt(0).toLowerCase() + localName.slice(1);
  const typeMeta = STEP_TYPES.find(t => t.tag === localLower);

  // Flows are rendered as edges (type bpmn:SequenceFlow). For those,
  // "incoming/outgoing" don't apply — fall back to source/target names.
  const isFlow = (el.type || '').endsWith('SequenceFlow');
  const incoming = isFlow ? null : (Array.isArray(el.incoming) ? el.incoming.length : 0);
  const outgoing = isFlow ? null : (Array.isArray(el.outgoing) ? el.outgoing.length : 0);

  // Documentation element lives under <bpmn:documentation> children.
  let documentation = '';
  if (Array.isArray(bo.documentation) && bo.documentation.length > 0) {
    documentation = bo.documentation.map(d => d.text || '').filter(Boolean).join('\n').trim();
  }

  return {
    id: bo.id || el.id || '',
    name: bo.name || '',
    type: el.type || '',
    typeLabel: typeMeta?.label || localName,
    lane: laneMap.get(bo.id || el.id) || '',
    incoming,
    outgoing,
    documentation
  };
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
