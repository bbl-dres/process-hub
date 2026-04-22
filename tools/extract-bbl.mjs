// One-off extractor for the BBL "TQ.21.00 Immobilienmanagement (K0)" PDFs.
// Walks the folder, pdftotext-s every PDF, parses the structured sections
// (Prozessverantwortliche, Zweck, Grundlagen, Relevante Dokumente,
// Prozessschritte), and writes a single Excel workbook the user can review
// and edit before we turn it into data/collections/bbl-immobilien.json.
//
// Requires: pdftotext on PATH (ships with Git for Windows) and xlsx npm package.
// Run:      npm run extract:bbl

import { spawnSync } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import XLSX from 'xlsx';

const PDFS_DIR        = resolve('../assets/TQ.21.00 Immobilienmanagement (K0)');
const OUTPUT_XLSX     = resolve('bbl-extraction.xlsx');
const OUTPUT_JSON     = resolve('../data/collections/bbl-immobilien.json');

// ─── pdftotext wrappers ─────────────────────────────────────────────
function pdftotext(path, { layout = true } = {}) {
  const args = ['-enc', 'UTF-8'];
  if (layout) args.push('-layout');
  args.push(path, '-');
  const res = spawnSync('pdftotext', args, { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 });
  if (res.status !== 0) throw new Error(`pdftotext failed on ${path}: ${res.stderr}`);
  // pdftotext emits \f at page breaks and \r on Windows. Normalize to plain
  // \n-delimited lines so our ^anchor regexes match against clean headers.
  return (res.stdout || '').replace(/\r/g, '').replace(/\f/g, '\n');
}

// ─── Shared parsing helpers ─────────────────────────────────────────
function squash(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

function firstLineMatching(lines, re) {
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) return { idx: i, line: lines[i] };
  }
  return null;
}

// Extract a column of multi-line text starting at a fixed x-offset on a line.
// Returns the concatenated words across that column until a blank line OR
// until a new label appears at col<8 (i.e. a new field label in column 0).
function readColumnBlock(lines, startIdx, fromCol) {
  const out = [];
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (i > startIdx && /^\S/.test(line)) break;       // next label at col 0
    if (line.trim() === '' && out.length) break;        // blank line ends block
    const slice = line.slice(fromCol, fromCol + 40);    // width cap
    const piece = slice.trim();
    if (piece) out.push(piece);
  }
  return squash(out.join(' '));
}

// ─── Metadata parsers ───────────────────────────────────────────────
function parseTitle(lines) {
  // First line that looks like "TQ.##.##.##.## …" or "D#.##.##…"
  const hit = firstLineMatching(lines, /^\s*(TQ|D\d)\.\d/);
  if (!hit) return { id: '', name: '' };
  // A few titles wrap to the next line (e.g. "TQ.21.00.00.30 Bewirtschaftung Anmiet-, Pachtverträge," + newline + "Eigene Baurechte")
  let combined = hit.line.trim();
  const next = (lines[hit.idx + 1] || '').trim();
  const titleHasTrailingComma = combined.endsWith(',');
  const nextLineLooksLikeTitleCont = next && !/^(Prozessverantwortliche|Findings|Zweck|Status|Inhalt)/i.test(next) && !/^Zuständigkeit/.test(next);
  if (titleHasTrailingComma && nextLineLooksLikeTitleCont) combined += ' ' + next;

  // Drop an accidental trailing "Status" header if it bled onto the title row
  combined = combined.replace(/\s+Status\s*$/i, '').trim();
  const m = combined.match(/^(\S+)\s+(.*)$/);
  return { id: m ? m[1] : combined, name: m ? m[2].trim() : '' };
}

function parseJiraRef(raw) {
  const m = raw.match(/R{1,2}ROZBBL-\d+/);
  return m ? m[0] : '';
}

// Parse the "Prozessverantwortliche" block by looking up each label and
// reading the name column (starts around col 16) until the next label.
function parseRoles(lines) {
  const roles = { owner: '', ownerOrg: '', releaseResp: '', releaseDate: '' };

  const ei = firstLineMatching(lines, /^Eigner\s/);
  if (ei) {
    // The name starts in the "Funktion / Person" column — typically around col 16.
    const fromCol = ei.line.indexOf('Eigner') + 'Eigner'.length;
    // Skip spaces between label and first content char.
    const restOfLine = ei.line.slice(fromCol);
    const padding = restOfLine.match(/^\s*/)[0].length;
    const absCol = fromCol + padding;
    const block = readColumnBlock(lines, ei.idx, absCol);
    // Split on the first comma — name before, org/role after.
    const commaIdx = block.indexOf(',');
    if (commaIdx >= 0) {
      roles.owner    = block.slice(0, commaIdx).trim();
      roles.ownerOrg = block.slice(commaIdx + 1).trim();
    } else {
      roles.owner = block;
    }
  }

  const fv = firstLineMatching(lines, /^Freigabe\s*$/);
  const fvLabel2 = fv ? firstLineMatching(lines.slice(fv.idx), /^Verantwortlich\b/) : null;
  if (fv && fvLabel2) {
    // Content sits on the SAME physical line as "Freigabe" (and continues
    // over the "Verantwortlich" line). Start reading from the Freigabe line
    // at the Funktion/Person column.
    const fromCol = fv.line.indexOf('Freigabe') + 'Freigabe'.length;
    const slice = fv.line.slice(fromCol);
    const padding = slice.match(/^\s*/)[0].length;
    const absCol = fromCol + padding;
    const block = readColumnBlock(lines, fv.idx, absCol);
    // "18.12.2023 / Dorothy Holt Wacker  Dorothy Holt Wacker, Leiterin ..."
    // Capture date + first name; org info follows a second comma.
    const dateMatch = block.match(/^([\dxX]{1,2}\.[\dxX]{1,2}\.[\dxX]{2,4})\s*\/\s*(.*)$/);
    if (dateMatch) {
      roles.releaseDate = dateMatch[1];
      // Split second half into name vs. later org info (heuristic: first comma).
      const after = dateMatch[2];
      const secondComma = after.indexOf(',');
      roles.releaseResp = (secondComma >= 0 ? after.slice(0, secondComma) : after).trim();
      // The name may repeat once with a role — leave that for the user to tidy.
    } else {
      roles.releaseResp = block;
    }
  }
  return roles;
}

// Read a labeled free-text section: everything between `startLabel` and
// `endLabels` (any of them), filtering out the right-sidebar column.
function parseSection(lines, startLabel, endLabels) {
  const start = firstLineMatching(lines, new RegExp(`^${startLabel}\\b`, 'i'));
  if (!start) return '';
  let endIdx = lines.length;
  for (const end of endLabels) {
    const e = firstLineMatching(lines.slice(start.idx + 1), new RegExp(`^${end}\\b`, 'i'));
    if (e) { endIdx = Math.min(endIdx, start.idx + 1 + e.idx); }
  }
  const slice = lines.slice(start.idx + 1, endIdx);
  // Drop sidebar content by cutting each line at col 90 (heuristic for the
  // right-column breakpoint in these Confluence exports).
  const body = slice.map(l => l.slice(0, 90).trimEnd()).filter(l => l.trim() !== '').join('\n');
  return body.trim();
}

function parseLinkedDocs(lines) {
  // "Relevante Dokumente" shows up BOTH in main flow and the right sidebar.
  // The right-sidebar version lists linked processes with their (060-…)
  // shelfmarks. Grab any line mentioning a TQ.XX… id plus the optional
  // shelfmark pattern "(060-5/4/…)".
  const out = [];
  const seen = new Set();
  for (const line of lines) {
    const matches = line.matchAll(/(TQ|D\d)\.\d+(?:\.\d+)+\s+[^()\n]+?\s*\(060[\d\/\-]+\)/g);
    for (const m of matches) {
      const entry = squash(m[0]);
      if (!seen.has(entry)) { seen.add(entry); out.push(entry); }
    }
  }
  return out;
}

// ─── Prozessschritte (step table) parsing ───────────────────────────
function parseSteps(lines) {
  // Locate the section
  const hdr = firstLineMatching(lines, /^Prozessschritte\b/i);
  if (!hdr) return [];
  // End at next major section
  const endCandidates = ['Beziehungen zu anderen', 'Änderungsverzeichnis', 'Abkürzungen und Begriffe'];
  let endIdx = lines.length;
  for (const end of endCandidates) {
    const e = firstLineMatching(lines.slice(hdr.idx + 1), new RegExp(`^${end}`, 'i'));
    if (e) endIdx = Math.min(endIdx, hdr.idx + 1 + e.idx);
  }
  const body = lines.slice(hdr.idx + 1, endIdx);

  // Find the header row "Name ... ID-... beeinflusst ... Beschreibung" to
  // learn column x-positions.
  const headerLine = body.find(l => /Name\s+ID[-\s]?composed/i.test(l)) ||
                     body.find(l => /Name\s+ID/i.test(l));
  if (!headerLine) return [];
  const cols = {
    name:         headerLine.indexOf('Name'),
    id:           Math.max(headerLine.search(/ID[-\s]?composed/i), headerLine.indexOf('ID')),
    influenced:   headerLine.indexOf('beeinflusst'),
    description:  headerLine.indexOf('Beschreibung')
  };

  // Walk subsequent lines. Each step occupies one or more lines; a new step
  // begins when `cols.name` has non-space content. Continuation lines have
  // whitespace in the name column.
  const steps = [];
  let cur = null;
  const headerIdx = body.indexOf(headerLine);
  for (let i = headerIdx + 1; i < body.length; i++) {
    const line = body[i];
    if (line.trim() === '') continue;
    const nameSlice = line.slice(cols.name, cols.id > 0 ? cols.id : undefined).trimEnd();
    const idSlice   = cols.id >= 0 ? line.slice(cols.id, cols.influenced > 0 ? cols.influenced : undefined).trimEnd() : '';
    const infSlice  = cols.influenced >= 0 ? line.slice(cols.influenced, cols.description > 0 ? cols.description : undefined).trimEnd() : '';
    const desSlice  = cols.description >= 0 ? line.slice(cols.description).trimEnd() : '';

    const isNewRow = nameSlice.trim() !== '';
    if (isNewRow) {
      if (cur) steps.push(cur);
      cur = {
        name:        squash(nameSlice),
        subId:       squash(idSlice),
        influenced:  squash(infSlice),
        description: squash(desSlice)
      };
    } else if (cur) {
      // continuation line: append to whichever column has content
      if (idSlice.trim())   cur.subId       = squash(cur.subId   + ' ' + idSlice);
      if (infSlice.trim())  cur.influenced  = squash(cur.influenced + ' ' + infSlice);
      if (desSlice.trim())  cur.description = squash(cur.description + ' ' + desSlice);
    }
  }
  if (cur) steps.push(cur);
  return steps;
}

// ─── Status derivation ──────────────────────────────────────────────
function deriveStatus(releaseDate) {
  if (!releaseDate) return '';
  if (/x/i.test(releaseDate)) return 'in-review';    // placeholder like xx.xx.xxxx
  if (/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(releaseDate)) return 'approved';
  return '';
}

// ─── Proposed level-2 grouping for this collection ──────────────────
const PROPOSED_GROUPS = [
  { id: 'akquisition',     name: 'Akquisition & Planung',       idRange: '01–05',
    description: 'Lösungsvorschläge, Machbarkeit, Auftragskoordination',
    idTest: n => n >= 1  && n <= 5 },
  { id: 'vollzug',         name: 'Vollzug & Übernahme',          idRange: '10–25',
    description: 'Vollzug Anmiete/Pacht, Verurkundung Kauf, Objektübernahme',
    idTest: n => n >= 10 && n <= 25 },
  { id: 'bewirtschaftung', name: 'Bewirtschaftung',              idRange: '30–49',
    description: 'Bewirtschaftung von Anmiet-, Pacht-, Baurechtsverträgen und Eigentum',
    idTest: n => n >= 30 && n <= 49 },
  { id: 'rueckgabe',       name: 'Rückgabe & Auflösung',         idRange: '50–90',
    description: 'Objektübergabe, Lösungsvorschläge Rückgabe, Auflösung, Verurkundung Verkauf',
    idTest: n => n >= 50 && n <= 90 },
  { id: 'stammdaten',      name: 'Stammdaten & Support',         idRange: '95–99',
    description: 'Immostammdaten/Energiedaten, Aktenmanagement, Planverwaltung / BIM',
    idTest: n => n >= 95 && n <= 99 }
];

function suggestGroup(id) {
  const m = id.match(/^TQ\.\d+\.\d+\.\d+\.(\d+)/);
  if (!m) return '';
  const n = parseInt(m[1], 10);
  const g = PROPOSED_GROUPS.find(g => g.idTest(n));
  return g ? g.id : '';
}

// ─── Main ───────────────────────────────────────────────────────────
function parsePdf(filename) {
  const path = join(PDFS_DIR, filename);
  const text = pdftotext(path, { layout: true });
  const lines = text.split('\n');

  const { id, name } = parseTitle(lines);
  const roles = parseRoles(lines);
  const jira = parseJiraRef(text);
  const zweck = parseSection(lines, 'Zweck / Bemerkungen', ['Grundlagen', 'Status', 'Relevante Dokumente']);
  const grundlagen = parseSection(lines, 'Grundlagen', ['Status', 'Relevante Dokumente', 'Prozess-Diagramm', 'Prozessschritte']);
  const linkedDocs = parseLinkedDocs(lines);
  const steps = parseSteps(lines);

  const status = deriveStatus(roles.releaseDate);
  const group = suggestGroup(id);

  const notes = [];
  if (!id) notes.push('Prozess-ID konnte nicht erkannt werden');
  if (!name) notes.push('Name leer');
  if (!roles.owner) notes.push('Eigner konnte nicht gelesen werden');
  if (/x/i.test(roles.releaseDate)) notes.push('Freigabedatum ist Platzhalter (xx.xx.xxxx) → Status: in-review');
  if (steps.length === 0) notes.push('Keine Prozessschritte gefunden (Diagramm-only Seite?)');

  return {
    process: {
      pdf_filename: filename,
      process_id: id,
      name,
      owner_name: roles.owner,
      owner_role: roles.ownerOrg,
      release_date: roles.releaseDate,
      release_responsible: roles.releaseResp,
      status,
      jira_ref: jira,
      proposed_group: group,
      purpose: zweck,
      foundations: grundlagen,
      linked_docs: linkedDocs.join(' | '),
      n_steps: steps.length,
      notes: notes.join(' · ')
    },
    steps: steps.map((s, i) => ({
      process_id: id,
      step_nr: i + 1,
      step_name: s.name,
      step_sub_id: s.subId,
      influenced_by: s.influenced,
      description: s.description
    }))
  };
}

function main() {
  const files = readdirSync(PDFS_DIR).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
  console.log(`Found ${files.length} PDFs in ${PDFS_DIR}`);

  const processes = [];
  const steps = [];
  for (const f of files) {
    process.stdout.write(`  ${f} … `);
    try {
      const { process: p, steps: s } = parsePdf(f);
      processes.push(p);
      steps.push(...s);
      process.stdout.write(`id=${p.process_id || '?'}, ${s.length} steps\n`);
    } catch (err) {
      console.error(`ERROR: ${err.message}`);
      processes.push({ pdf_filename: f, notes: `PARSE ERROR: ${err.message}` });
    }
  }

  // Sort processes by ID so the sheet lands in natural order.
  processes.sort((a, b) => (a.process_id || '').localeCompare(b.process_id || ''));

  const groupsSheet = PROPOSED_GROUPS.map(g => ({
    group_id: g.id, group_name: g.name, id_range: g.idRange, description: g.description,
    n_processes: processes.filter(p => p.proposed_group === g.id).length
  }));

  // Write workbook
  const wb = XLSX.utils.book_new();

  const wsProcesses = XLSX.utils.json_to_sheet(processes);
  wsProcesses['!cols'] = [
    { wch: 55 }, { wch: 20 }, { wch: 40 }, { wch: 22 }, { wch: 30 },
    { wch: 12 }, { wch: 22 }, { wch: 12 }, { wch: 14 }, { wch: 16 },
    { wch: 80 }, { wch: 60 }, { wch: 80 }, { wch: 8  }, { wch: 50 }
  ];
  XLSX.utils.book_append_sheet(wb, wsProcesses, 'Processes');

  const wsSteps = XLSX.utils.json_to_sheet(steps);
  wsSteps['!cols'] = [
    { wch: 20 }, { wch: 6 }, { wch: 40 }, { wch: 22 }, { wch: 25 }, { wch: 80 }
  ];
  XLSX.utils.book_append_sheet(wb, wsSteps, 'Steps');

  const wsGroups = XLSX.utils.json_to_sheet(groupsSheet);
  wsGroups['!cols'] = [{ wch: 18 }, { wch: 26 }, { wch: 10 }, { wch: 60 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, wsGroups, 'Groups (proposed)');

  XLSX.writeFile(wb, OUTPUT_XLSX);
  console.log(`\nWrote ${OUTPUT_XLSX}`);
  console.log(`  Processes: ${processes.length}`);
  console.log(`  Steps:     ${steps.length}`);

  // Also emit the app-facing JSON collection.
  const jsonProcesses = processes.filter(p =>
    p.process_id && /^TQ\.21\.00\.00\.\d+$/.test(p.process_id)
  );
  writeCollectionJson(jsonProcesses);
}

function writeCollectionJson(processes) {
  const areas = PROPOSED_GROUPS.map(g => ({
    id: g.id,
    number: PROPOSED_GROUPS.indexOf(g) + 1 + '',
    name: g.name,
    accent: { akquisition: '#1F4E8A', vollzug: '#2E7D32', bewirtschaftung: '#B45309',
              rueckgabe: '#7C3AED', stammdaten: '#5F5F5A' }[g.id] || '#5F5F5A',
    description: g.description,
    groups: []
  }));

  const byId = Object.fromEntries(areas.map(a => [a.id, a]));
  for (const p of processes) {
    const targetId = p.proposed_group || 'stammdaten';
    const a = byId[targetId];
    if (!a) continue;
    a.groups.push({
      id: p.process_id,
      name: p.name,
      active: true,
      bpmn: `assets/bpmn-bbl/${p.process_id}.bpmn`,
      description: p.purpose || '',
      status: p.status || 'approved',
      version: '1.0',
      updatedAt: normalizeDate(p.release_date),
      tags: []
      // owner/responsible/expert intentionally omitted — the PDFs contain
      // real employee names; to be pseudonymized or mapped to people.json
      // in a follow-up. Leaving undefined keeps the table rendering "—".
    });
  }

  // Sort groups within each area by numeric suffix
  for (const a of areas) {
    a.groups.sort((x, y) => {
      const nx = parseInt(x.id.match(/\.(\d+)$/)?.[1] || '0', 10);
      const ny = parseInt(y.id.match(/\.(\d+)$/)?.[1] || '0', 10);
      return nx - ny;
    });
  }
  const populatedAreas = areas.filter(a => a.groups.length > 0);

  const out = { id: 'bbl-immobilien', areas: populatedAreas };
  writeFileSync(OUTPUT_JSON, JSON.stringify(out, null, 2), 'utf-8');
  console.log(`\nWrote ${OUTPUT_JSON}`);
  console.log(`  Areas:     ${populatedAreas.length}`);
  console.log(`  Processes: ${populatedAreas.reduce((n, a) => n + a.groups.length, 0)}`);
}

// Convert "21.12.2023" (or "xx.xx.xxxx") to ISO yyyy-mm-dd; leave empty
// strings alone so the collection JSON matches the existing style.
function normalizeDate(s) {
  if (!s) return '';
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return '';
  return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
}

main();
