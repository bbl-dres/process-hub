# Process Hub

A single-page, vanilla-JS reader for browsing BPMN process landscapes. Inspired by SAP Signavio's Process Collaboration Hub — structured like a data catalog, read-only, and designed for non-modellers to navigate collections of documented business processes.

No build step. No framework. Load over an HTTP server and go.

## Features

- **Multi-collection catalog.** Each collection is a self-contained library with its own hierarchy (Lebenszyklus, Leistungsbereich, …). Side-by-side today: [BUW-Prozessmodell](data/collections/buw.json) (Bau- und Immobilienwirtschaft, BUW Wuppertal) and [BBL Immobilienmanagement](data/collections/bbl-immobilien.json) (Bundesamt für Bauten und Logistik, TQ.21.00 K0).
- **Three views per collection:** Tabelle (sortable, groupable, filterable), Diagramm (Signavio-style tile landscape), Metadaten.
- **Three tabs per process:** Diagramm (bpmn-js viewer with pan / wheel-zoom / fullscreen), Schritte (flow nodes extracted live from the BPMN XML), Metadaten (seven structured sections).
- **Exports** from any collection or process: Excel (.xlsx), PDF (simple v1 layout), BPMN download (single file or ZIP).
- **Filter + grouping:** clickable Bereich badges add to active filters; group the table by Bereich / Owner / Status.
- **Home** with KPIs and a Letzte-Aktivitäten table sorted by `updatedAt`.
- **Workflows & API** page with per-collection export buttons and placeholders for REST API / Import.
- **Process metadata schema** informed by BPM CBOK, ArchiMate, ISO 9001 and Dublin Core — every process carries a fixed set of 20 fields, empty-by-default so gaps are visible in the JSON.

## Running locally

Open a terminal in the project root and start any static HTTP server — for example:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000> in a browser.

> `file://` does **not** work: the app fetches `data/collections.json` + per-collection JSON + BPMN files, which browsers block under the `file:` scheme.

## Project structure

```
process-hub/
├── index.html                 # App shell (header, sidebar, main, footer)
├── css/
│   ├── tokens.css             # Design tokens (colors, spacing, typography)
│   └── styles.css             # All component + view styles
├── js/
│   └── app.js                 # Router + all views + exports (vanilla, no build)
├── data/
│   ├── collections.json       # Collection index
│   ├── collections/
│   │   ├── buw.json
│   │   └── bbl-immobilien.json
│   └── people.json            # Shared person roster (referenced by id)
├── assets/
│   ├── bpmn/                  # BUW source BPMN files (Aeneis export)
│   └── bpmn-bbl/              # BPMN files for BBL Immobilienmanagement
├── tools/
│   ├── extract-bbl.mjs        # One-off Node script: PDF → JSON + XLSX
│   ├── package.json           # xlsx dependency
│   └── bbl-extraction.xlsx    # Latest extractor output for review
├── DESIGN.md                  # Information architecture + metadata schema
└── README.md                  # This file
```

## Data model

Each collection has its own JSON with an `areas` → `groups` (processes) hierarchy. Every process carries the same canonical attribute shape, with empty defaults where unset:

```jsonc
{
  "id": "TQ.21.00.00.02",
  "name": "Machbarkeit Projektdefinition",
  "bpmn": "assets/bpmn-bbl/TQ.21.00.00.02.bpmn",

  // Content (BPM CBOK)
  "description": "",
  "purpose": "",
  "trigger": "",
  "outputs": [],

  // Ownership (RACI-lite, people referenced by id from data/people.json)
  "owner": "",
  "responsible": [],
  "expert": "",

  // Lifecycle
  "status": "approved",          // draft | in-review | approved | deprecated
  "version": "1.0",
  "validFrom": "2023-12-21",
  "validUntil": "",
  "updatedAt": "2023-12-21",
  "reviewCycleMonths": null,

  // Classification
  "classification": "",
  "tags": [],

  // Context
  "systems": [],
  "standards": [],
  "linkedProcesses": { "predecessor": [], "successor": [], "related": [] },
  "documents": []
}
```

Full rationale, trade-offs behind each field, and the standards they map to are in [DESIGN.md](DESIGN.md).

## Routes

| URL | View |
|---|---|
| `#/` | Home (KPIs + collections + activity) |
| `#/chat` | KI-Assistent (placeholder) |
| `#/workflows` | Workflows & API (exports + REST API placeholder) |
| `#/c/{id}` | Collection → Tabelle (default) |
| `#/c/{id}/diagram` | Collection → Diagramm tile landscape |
| `#/c/{id}/metadata` | Collection → Metadaten |
| `#/c/{id}/process/{pid}` | Process → Diagramm (default) |
| `#/c/{id}/process/{pid}/steps` | Process → Schritte |
| `#/c/{id}/process/{pid}/metadata` | Process → Metadaten |

## Tooling

### BBL extractor

[tools/extract-bbl.mjs](tools/extract-bbl.mjs) reads Confluence-style PDF exports of the BBL Immobilienmanagement processes and produces:

- `tools/bbl-extraction.xlsx` — Processes / Steps / Groups sheets for human review.
- `data/collections/bbl-immobilien.json` — populated with id, name, purpose (Zweck), standards (Grundlagen), linked processes (Relevante Dokumente), validFrom (Freigabedatum), status.

The source PDFs are **not** tracked in this repo (too bulky and not open-source). To re-run, drop the `TQ.21.00 Immobilienmanagement (K0)` folder into `assets/`, then:

```bash
cd tools
npm install            # one-time: installs xlsx
node extract-bbl.mjs
```

### BPMN files for BBL

The 18 files in [assets/bpmn-bbl/](assets/bpmn-bbl/) were reconstructed from the source PDFs' embedded diagrams via a batch of Claude sub-agents — each one reading a high-DPI PNG render of a diagram page and producing BPMN 2.0 XML (semantic layer + BPMN DI for layout). Quality varies with source-diagram clarity; task names in the Schritte tab come authoritatively from the Prozessschritte tables.

## Dependencies

Runtime (via CDN, no install):

- [bpmn-js 17](https://github.com/bpmn-io/bpmn-js) — BPMN viewer with pan / wheel-zoom
- [SheetJS (xlsx) 0.18](https://sheetjs.com/) — Excel export
- [jsPDF 2.5 + autotable 3.8](https://github.com/parallax/jsPDF) — PDF export
- [JSZip 3.10](https://stuk.github.io/jszip/) — BPMN ZIP download
- [Lucide](https://lucide.dev/) — icons

Tooling: Node 18+ and `pdftotext` on PATH (ships with Git for Windows) for the BBL extractor.

## Acknowledgements

- **BUW-Prozessmodell** — Lehrstuhl für Digital Process and Building Management, [Bergische Universität Wuppertal](https://dpbb.uni-wuppertal.de/de/forschung/buw-prozessmodell-fuer-die-bau-und-immobilienwirtschaft/). Source of the 20 BPMN files under `assets/bpmn/`.
- **BBL Immobilienmanagement** — Bundesamt für Bauten und Logistik. Process documentation used as the basis for the Immobilienmanagement collection.
- **SAP Signavio Process Collaboration Hub** — structural inspiration for the landscape + reader UX.
- **[data-catalog/prototype-sqlite](../data-catalog/prototype-sqlite)** — sibling project, source of the ported tokens + styles that give this UI its look and feel.

## License

See [LICENSE](LICENSE).
