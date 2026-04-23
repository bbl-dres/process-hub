// exports.js — Excel / PDF / BPMN-ZIP downloads for the current route.
// Row-shape dealt with here is the new { node, path } form. "Container"
// exports walk the subtree under the current route; "process" exports
// cover just the one BPMN-bearing node.

function dispatchExport(kind) {
  const r = state.route;
  if (r.name !== 'node') return;
  const resolved = resolveNodeRoute(r);
  if (!resolved) return;
  const { c, node, trail } = resolved;

  if (isProcessNode(node)) {
    // Leaf / process-level export
    if (kind === 'excel') return exportProcessExcel(c, node, trail);
    if (kind === 'pdf')   return exportProcessPdf(c, node, trail);
    if (kind === 'bpmn')  return downloadProcessBpmn(node);
    return;
  }

  // Container: walk the subtree under `node` to collect processes. Helper
  // `collectRowsUnder` lives in app.js so views/exports/handlers share one
  // canonical definition of "process descendants."
  const rows = collectRowsUnder(node, trail);
  if (kind === 'excel') return exportContainerExcel(c, node, rows);
  if (kind === 'pdf')   return exportContainerPdf(c, node, rows);
  if (kind === 'bpmn')  return downloadContainerBpmnZip(c, node, rows);
}

// Return the Level-1 ancestor for a given row (or the row's node if it's L1).
function level1Of(path, c) {
  if (!path.length) return null;
  const hit = findNodeByPath(c, path.slice(0, 1));
  return hit?.node || null;
}

// ─── Excel exports ──────────────────────────────────────────────────
function exportProcessExcel(c, node, trail) {
  return withBusy('Excel wird erstellt…', async () => {
    const wb = XLSX.utils.book_new();
    const wsMeta = XLSX.utils.aoa_to_sheet(processMetadataRows(c, node, trail));
    wsMeta['!cols'] = [{ wch: 24 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, wsMeta, 'Metadaten');

    if (node.bpmn) {
      try {
        const steps = await fetchAndParseSteps(node.bpmn);
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
    XLSX.writeFile(wb, `${sanitizeFilename(node.id)}.xlsx`);
  });
}

function exportContainerExcel(c, rootNode, rows) {
  return withBusy('Excel wird erstellt…', async () => {
    const procRows = rows.map(({ node, path }) => {
      const l1 = level1Of(path, c);
      return {
        'Prozess-ID':   node.id,
        'Name':         node.name,
        'Ebene 1':      l1 ? `${l1.id} ${l1.name}` : '',
        'Status':       STATUS_LABELS[node.status]?.label || node.status || '',
        'Version':      node.version || '',
        'Aktualisiert': node.updatedAt || '',
        'Owner':        resolvePerson(node.owner)?.name || '',
        'Responsible':  (node.responsible || []).map(id => resolvePerson(id)?.name).filter(Boolean).join(', '),
        'Expert':       resolvePerson(node.expert)?.name || '',
        'Tags':         (node.tags || []).join(', '),
        'Beschreibung': node.description || '',
        'BPMN-Datei':   node.bpmn || ''
      };
    });

    const wb = XLSX.utils.book_new();
    const wsProc = XLSX.utils.json_to_sheet(procRows);
    wsProc['!cols'] = [
      { wch: 20 }, { wch: 40 }, { wch: 30 }, { wch: 14 }, { wch: 10 },
      { wch: 14 }, { wch: 22 }, { wch: 30 }, { wch: 22 }, { wch: 30 },
      { wch: 60 }, { wch: 40 }
    ];
    XLSX.utils.book_append_sheet(wb, wsProc, 'Prozesse');

    const stepsNested = await Promise.all(rows
      .filter(r => r.node.bpmn)
      .map(async ({ node }) => {
        try {
          const steps = await fetchAndParseSteps(node.bpmn);
          return steps.map((s, i) => ({
            'Prozess-ID':   node.id,
            'Prozess-Name': node.name,
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

    const scopeId = rootNode.id === c.id ? c.id : `${c.id}_${rootNode.id}`;
    XLSX.writeFile(wb, `${sanitizeFilename(scopeId)}.xlsx`);
  });
}

function processMetadataRows(c, node, trail) {
  const l1 = trail.length >= 1 ? trail[0] : null;
  return [
    ['Feld', 'Wert'],
    ['Prozess-ID',   node.id],
    ['Name',         node.name],
    ['Sammlung',     c.name],
    ['Ebene 1',      l1 ? `${l1.id} ${l1.name}` : ''],
    ['Status',       STATUS_LABELS[node.status]?.label || node.status || ''],
    ['Version',      node.version || ''],
    ['Aktualisiert', node.updatedAt || ''],
    ['Owner',        resolvePerson(node.owner)?.name || ''],
    ['Responsible',  (node.responsible || []).map(id => resolvePerson(id)?.name).filter(Boolean).join(', ')],
    ['Expert',       resolvePerson(node.expert)?.name || ''],
    ['Tags',         (node.tags || []).join(', ')],
    ['Beschreibung', node.description || ''],
    ['BPMN-Datei',   node.bpmn || '']
  ];
}

// ─── PDF exports (simple v1 layout) ─────────────────────────────────
function exportProcessPdf(c, node, trail) {
  return withBusy('PDF wird erstellt…', async () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    let steps = [];
    if (node.bpmn) {
      try { steps = await fetchAndParseSteps(node.bpmn); } catch { /* ignore */ }
    }
    renderProcessPdfPage(doc, c, node, trail, steps, { idx: 1, total: 1 });
    doc.save(`${sanitizeFilename(node.id)}.pdf`);
  });
}

function exportContainerPdf(c, rootNode, rows) {
  return withBusy('PDF wird erstellt…', async () => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    if (rows.length === 0) {
      doc.setFontSize(14).text('Keine Prozesse in der aktuellen Auswahl.', 20, 30);
      doc.save(`${sanitizeFilename(c.id)}.pdf`);
      return;
    }
    rows.forEach((r, i) => {
      if (i > 0) doc.addPage();
      const hit = findNodeByPath(c, r.path);
      const trail = hit?.trail || [];
      renderProcessPdfPage(doc, c, r.node, trail, [], { idx: i + 1, total: rows.length });
    });
    const scopeId = rootNode.id === c.id ? c.id : `${c.id}_${rootNode.id}`;
    doc.save(`${sanitizeFilename(scopeId)}.pdf`);
  });
}

function renderProcessPdfPage(doc, c, node, trail, steps, ctx) {
  const margin = 20;
  const pageW = doc.internal.pageSize.getWidth();
  const l1 = trail.length >= 1 ? trail[0] : null;

  // Title
  doc.setFontSize(16).setFont('helvetica', 'bold').setTextColor(20);
  doc.text(doc.splitTextToSize(node.name, pageW - 2 * margin), margin, margin + 2);
  doc.setFontSize(10).setFont('helvetica', 'normal').setTextColor(100);
  const subline = [node.id, c.name, l1 ? `${l1.id} ${l1.name}` : null].filter(Boolean).join('  ·  ');
  doc.text(subline, margin, margin + 10);

  // Metadata table
  const ownerName = resolvePerson(node.owner)?.name || '—';
  const respNames = (node.responsible || []).map(id => resolvePerson(id)?.name).filter(Boolean).join(', ') || '—';
  const expertName = resolvePerson(node.expert)?.name || '—';

  doc.autoTable({
    startY: margin + 15,
    head: [['Feld', 'Wert']],
    body: [
      ['Status',       STATUS_LABELS[node.status]?.label || node.status || '—'],
      ['Version',      node.version || '—'],
      ['Aktualisiert', node.updatedAt || '—'],
      ['Owner',        ownerName],
      ['Responsible',  respNames],
      ['Expert',       expertName],
      ['Tags',         (node.tags || []).join(', ') || '—']
    ],
    theme: 'plain',
    styles: { fontSize: 10, cellPadding: 2 },
    headStyles: { fillColor: [240, 240, 240], textColor: 80, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 40, fontStyle: 'bold' } },
    margin: { left: margin, right: margin }
  });

  let y = (doc.lastAutoTable?.finalY || margin + 15) + 8;

  if (node.description) {
    doc.setFontSize(12).setFont('helvetica', 'bold').setTextColor(20);
    doc.text('Zweck / Bemerkungen', margin, y);
    doc.setFontSize(10).setFont('helvetica', 'normal').setTextColor(40);
    const lines = doc.splitTextToSize(node.description, pageW - 2 * margin);
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
async function downloadProcessBpmn(node) {
  if (!node.bpmn) return;
  try {
    const res = await fetch(encodeURI(node.bpmn));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    downloadBlob(new Blob([xml], { type: 'application/xml' }), `${sanitizeFilename(node.id)}.bpmn`);
  } catch (err) {
    notify(`Download fehlgeschlagen: ${err.message}`, 'error');
  }
}

function downloadContainerBpmnZip(c, rootNode, rows) {
  return withBusy('ZIP wird erstellt…', async () => {
    const zip = new window.JSZip();
    const tasks = [];
    rows.forEach(({ node }) => {
      if (!node.bpmn) return;
      tasks.push(fetch(encodeURI(node.bpmn))
        .then(r => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then(xml => zip.file(`${sanitizeFilename(node.id)}.bpmn`, xml))
        .catch(err => console.warn(`Skip ${node.id}:`, err.message)));
    });
    await Promise.all(tasks);
    const blob = await zip.generateAsync({ type: 'blob' });
    const scopeId = rootNode.id === c.id ? c.id : `${c.id}_${rootNode.id}`;
    downloadBlob(blob, `${sanitizeFilename(scopeId)}-bpmn.zip`);
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
    notify(`Export fehlgeschlagen: ${err.message}`, 'error');
  }).finally(() => overlay.remove());
}
