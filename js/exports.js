// exports.js - Excel / PDF / BPMN-ZIP downloads. Depends on state
// (for filtered data), parseBpmnSteps from bpmn.js, and renderStatusBadge
// from views.js.

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
