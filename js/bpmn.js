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
            <tr>
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
