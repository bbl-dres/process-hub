# Process Hub

![Process Hub social preview](assets/social-preview.jpg)

[![Demo](https://img.shields.io/badge/demo-GitHub%20Pages-2ea44f?logo=github&logoColor=white)](https://bbl-dres.github.io/process-hub/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A read-only browser for navigating BPMN process landscapes without requiring users to work in a modelling tool.

> [!CAUTION]
> This is an unofficial demonstration prototype. Its functions and reconstructed process content are not production-ready and must not be treated as an authoritative process repository.

## Demo

**Live demo:** https://bbl-dres.github.io/process-hub/

<table border="0" cellpadding="0" cellspacing="0" role="presentation" width="100%">
  <tr>
    <td width="50%" valign="top"><img src="assets/images/preview-1.jpg" alt="Process Hub dashboard" width="100%"/></td>
    <td width="50%" valign="top"><img src="assets/images/preview-2.jpg" alt="Process Hub BPMN diagram view" width="100%"/></td>
  </tr>
</table>

## Features

- Browse multiple process collections through a recursive catalogue tree.
- Switch container views between a visual landscape and a sortable, filterable table.
- Inspect BPMN diagrams or read their extracted process steps.
- Open contextual process and element details in a resizable inspector.
- Save comments locally in the browser and share deep links to selected BPMN elements.
- Filter and group processes by owner or status.
- Export collection data to Excel or PDF and download BPMN files individually or as a ZIP.

## Run locally

The app fetches JSON and BPMN files, so serve the repository over HTTP:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000/>.

## Documentation

- [Design and data model](DESIGN.md) — scope, information architecture, views, metadata schema, and file layout.

## Acknowledgements

- [BUW-Prozessmodell](https://dpbb.uni-wuppertal.de/de/forschung/buw-prozessmodell-fuer-die-bau-und-immobilienwirtschaft/) supplied the source material for the BPMN files under `assets/bpmn/`.
- BBL Immobilienmanagement process documentation provided the basis for the BBL collection.
- [data-catalog/prototype-sqlite](https://github.com/bbl-dres/data-catalog/tree/main/prototype-sqlite) provided adapted visual tokens and styles.

## License

Licensed under the [MIT License](LICENSE).
