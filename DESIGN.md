# Process Hub Reader — Design

A single-page, vanilla JS reader for browsing a process landscape. Inspired by SAP Signavio's Process Collaboration Hub, but read-only (no editing, no modeling tools). The goal is to help non-author stakeholders understand *what processes exist*, *how they relate*, and *what each one does* — without needing a modeling license or BPMN expertise.

## Scope

**In scope**
- Browse a hierarchy of business areas → process groups → individual processes
- View process diagrams with pan/zoom and node details
- Read attributes, descriptions, and linked artifacts for any element
- Search, favorite, and share deep links to any view

**Out of scope (at least for v1)**
- Editing diagrams, attributes, or the hierarchy
- Collaboration features (comments, approvals, workflow)
- Authentication / multi-user concerns
- Live data / backend — content is loaded from static JSON

## Information architecture

```
Hub
├── Landscape Overview       (top-level grid of business areas)
│   └── Area Detail          (one area expanded, shows its process groups)
│       └── Process Diagram  (BPMN-style diagram of one process)
│           └── Element Detail (attributes of a clicked task/event/gateway)
├── Search results
└── Favorites / Recents
```

Every view has a stable URL (hash-based routing, e.g. `#/area/oil-gas`, `#/process/credit-check`) so any view is shareable and back/forward work.

## Data model (static JSON)

A single `data/landscape.json` drives everything. Rough shape:

```jsonc
{
  "areas": [
    {
      "id": "energy-natural-resources",
      "name": "Energy and Natural Resources",
      "color": "#A33",
      "groups": [
        { "id": "oil-gas", "name": "Oil, Gas, & Energy", "icon": "oil",
          "description": "...",
          "diagrams": ["capability-map-oil-gas", "e2e-oil-gas"] }
      ]
    }
  ],
  "diagrams": [
    {
      "id": "credit-check",
      "name": "Credit Check Process",
      "type": "bpmn",
      "source": "diagrams/credit-check.svg",   // pre-rendered SVG
      "elements": [
        { "id": "task-1", "name": "Perform Credit Checks",
          "kind": "task", "description": "...", "owner": "Sales Rep",
          "links": [{ "label": "Work instruction", "url": "..." }] }
      ]
    }
  ]
}
```

Storing diagrams as **pre-rendered SVGs** with element IDs that match the JSON lets us skip a real BPMN renderer and still get pan/zoom + clickable elements. If we later want true BPMN rendering, we can swap this layer without changing the views.

## Main views

### 1. App shell

Always visible, wraps every view.

- **Top bar**: app title ("Process Hub"), global search input, breadcrumb of the current location.
- **Left rail** (icon-only): Home, Favorites, Recents. Collapsible on narrow screens.
- **Right slide-over panel**: context-sensitive details. Opens when a tile, diagram, or element is selected. Closes via `×` or Esc.
- **Main content area**: the active view, driven by the route.

Routing is hash-based and handled by a tiny router (~30 lines). No framework.

### 2. Landscape Overview (home)

The entry point — a grid of **business areas**, each containing a cluster of **process group tiles**. Matches the Signavio "Industry Overview" screenshot.

- Each area is a titled section with a colored accent bar.
- Each tile has an icon, a name, and a click target.
- Hover highlights the tile; click opens the right panel with the area's diagrams, description, and a "View diagram" action.
- Empty/inactive tiles are rendered in a muted style (like the grayed-out tiles in the reference).

Interactions:
- Click tile → right panel populates with area detail.
- Click a diagram link in the panel → navigates to **Process Diagram**.
- Keyboard: Tab through tiles, Enter to open.

### 3. Process Diagram viewer

The core read view. Shows one diagram (capability map, value chain, or BPMN process).

Layout:
- **Canvas** (center): the SVG diagram, with:
  - Pan (drag) and zoom (wheel / pinch / `+`/`-` buttons).
  - A floating toolbar: fullscreen, zoom in/out, fit-to-screen, reset, mini-map toggle.
  - A zoom-level readout (e.g. "89%").
- **Legend** dropdown: explains shape/color meanings (task, event, gateway, lane, etc.).
- **Overlays** dropdown: toggles visual overlays (e.g. "highlight automated tasks", "show systems") — each overlay is a named set of element IDs with a CSS class applied.
- **Element selection**: clicking any element with an `id` matching the JSON opens the right panel with that element's details.

No editing affordances. No palette, no convention-check panel — those are authoring concerns.

### 4. Details panel (right slide-over)

Shared component, different content per context:

- **Area / group selected**: name, description, list of available diagrams, owner, last-reviewed date.
- **Diagram element selected**: name, kind (task/event/gateway/lane), description, responsible role, linked documents, linked sub-process (click to navigate).
- **Search result hovered**: quick preview.

Always has a clear "open full view" action where relevant, so the panel is a preview — never the only way to see information.

### 5. Search

Global, always in the top bar. Indexes across all areas, groups, diagrams, and elements.

- Live results as you type (debounced).
- Grouped by type (Areas, Diagrams, Elements).
- Enter on a result navigates to it; clicking a diagram-element result navigates to its diagram and auto-selects the element.
- Simple client-side fuzzy match — no external search service.

### 6. Favorites & Recents

- **Favorites**: star any tile, diagram, or element. Persisted in `localStorage`.
- **Recents**: last N visited diagrams, auto-tracked on navigation.
- Both are shown in the left rail's slide-out lists.

## Non-functional notes

- **No build step.** Plain `index.html` + ES modules + a small CSS file. Load `data/landscape.json` via `fetch`.
- **Accessibility**: keyboard navigation through tiles and diagram elements, ARIA roles on the panel and dialogs, visible focus rings, respect `prefers-reduced-motion` for pan/zoom transitions.
- **Responsive**: the grid collapses to a single column below ~720px; the right panel becomes a bottom sheet on mobile.
- **State**: URL is the source of truth for "where am I"; `localStorage` only holds favorites and recents.

## Proposed file layout

```
index.html
styles.css
app.js                 // bootstrap + router
views/
  landscape.js         // overview grid
  diagram.js           // diagram viewer (pan/zoom, overlays, selection)
  panel.js             // shared right slide-over
  search.js            // search UI + index
data/
  landscape.json
  diagrams/*.svg
```

## Open questions

1. **Diagram source format.** Pre-rendered SVG is simplest. Do you already have SVG exports, or will we need to hand-author a couple of sample diagrams to build against?
2. **Scope of v1.** Is it enough to ship the **Landscape Overview + Diagram viewer + Details panel**, and defer search/favorites to v2?
3. **Hierarchy depth.** Signavio shows Area → Group → Diagram. Do we need a deeper drill (e.g. Group → Sub-group → Diagram), or is three levels enough?
4. **Styling direction.** Match Signavio's visual language closely, or use it as structural inspiration only and apply our own look?

---

## Process metadata schema

The metadata layer is **collection-independent**: every process across every collection uses the same field set, so grouping, filtering and search behave consistently. The BPMN file itself carries only the diagram; business metadata lives in the collection's JSON.

Shared `data/people.json` holds the roster; processes reference people by `id` so renames don't fan out and grouping keys are stable.

### Per-process fields (v1 subset marked ✓)

| Field | Type | Purpose |
| --- | --- | --- |
| `id`, `name`, `bpmn` ✓ | string | identity + diagram pointer |
| `description` ✓ | string | short summary (table + panel) |
| `tags` ✓ | string[] | filtering + grouping |
| `owner` ✓ | personId | accountable (A in RACI) |
| `responsible` ✓ | personId[] | does the work (R in RACI) |
| `expert` ✓ | personId | subject-matter contact |
| `status` ✓ | enum | `draft` · `in-review` · `approved` · `deprecated` |
| `version` ✓ | string | e.g. `"1.2"` |
| `updatedAt` ✓ | ISO date | drives "stale" signal and sort |
| `reviewCycleMonths` ✓ | number | used with `updatedAt` for the stale signal |
| `purpose` | string | why this process exists |
| `trigger`, `outcome` | string | what starts it / what it delivers |
| `systems` | string[] | supporting applications |
| `standards` | string[] | regulations, norms, internal policies |
| `linkedProcesses` | `{ predecessor[], successor[], related[] }` | graph edges |
| `documents` | `{ label, url }[]` | work instructions, templates |

### Shared `data/people.json`

```jsonc
{
  "people": [
    { "id": "p_müller",  "name": "Dr. Anna Müller",   "org": "Projektleitung", "email": "anna.mueller@example.org" },
    { "id": "p_schmidt", "name": "Tobias Schmidt",    "org": "Fachplanung" },
    ...
  ]
}
```

### Grouping (list view)

The tab-bar gets a `.grouping-btn` dropdown next to Filter. Options:

- **Bereich** (= level-2 area) — default
- **Owner** (by `owner` person)
- **Status**
- **Tag** (first entry in `tags[]`)
- **Ohne Gruppierung** (flat)

Rendered in the table as `.group-header` rows between `tbody` groups. Not applied in the diagram view (the area-card layout already groups visually).

### Deferred

- Full RACI (`consulted` / `informed`) — rarely filled in practice.
- KPIs, risks, controls — belong to a process-management discipline, not a reader.
- Per-collection custom fields — adding them would break consistency; if we hit a real need, revisit with a `customFields: {}` bag.
