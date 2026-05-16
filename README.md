<p align="center">
  <img width="100%" height="1408" alt="LIMS — Laboratory Information Management System" src="https://github.com/user-attachments/assets/b35a16d2-2e8f-4a73-849a-feef9de558ec" />

</p>

<h1 align="center">🔬 LIMS: Laboratory Information Management</h1>

<p align="center">
  <strong>A modern web-based system for managing laboratory measurements, device reservations, and research data — built as a Master's thesis project.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Vue.js-3.4-4FC08D?logo=vuedotjs&logoColor=white" alt="Vue 3" />
  <img src="https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vuetify-3.9-1867C0?logo=vuetify&logoColor=white" alt="Vuetify" />
  <img src="https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Pinia-2.1-FFD859?logo=pinia&logoColor=black" alt="Pinia" />
  <img src="https://img.shields.io/badge/Keycloak-26-4D4D4D?logo=keycloak&logoColor=white" alt="Keycloak" />
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white" alt="Docker" />
</p>

---

## 📋 About

**LIM** (Laboratory Information Management) is a full-featured web administration frontend developed as part of a Master's thesis at [Mendel University in Brno](https://mendelu.cz). It provides researchers and lab staff with a unified platform to:

- 📊 **Record & visualize measurements** with advanced charting and statistical analysis
- 📅 **Reserve laboratory devices** via a rich calendar system with conflict detection
- 🔬 **Manage research projects** with Kanban boards and team collaboration
- 📤 **Publish datasets to Zenodo** for open-access research data sharing
- 📥 **Import data** from CSV/Excel with smart template-based column mapping

> 🎓 **Thesis context:** This application serves the agricultural research center [CeNAgriVeT](https://cenagrivet.mendelu.cz/) at Mendel University, streamlining how researchers handle experimental data and shared lab equipment.

---

## ✨ Key Features

### 📊 Measurements & Data Analysis
- Create structured measurements from customizable templates (text, number, boolean, date, select, rating fields)
- Interactive **Chart.js** visualizations with logarithmic/linear scale switching
- **Linear & logarithmic regression** analysis with R² statistics
- Side-by-side measurement comparison
- CSV/Excel import with intelligent header mapping wizard
- Full-text search, filtering, and sorting

### 📅 Device Reservation System
- **Week / Day / Month** calendar views
- **Recurring events** (daily, weekly, monthly, yearly with custom rules)
- Real-time **conflict detection** across overlapping reservations
- Color-coded event cards per device
- Reservation editing with series scope handling (single / this & future / all)
- Machine-grouped daily view for lab managers

### 🗂️ Project Management
- Multi-project workspace with role-based access
- **Kanban board** with drag-and-drop task management and filtering
- Project summary dashboard
- Team member assignment

### 📤 Zenodo Integration
- Publish measurement datasets directly to [Zenodo](https://zenodo.org/) open-access repository
- DOI generation for citable research data
- Metadata editing (creators, keywords, license, communities)
- Sandbox mode for testing before real publication

### 🔬 Device Management
- Full CRUD for laboratory devices with detailed specs
- Device-measurement linking
- Device selection in reservations with capacity tracking

### 📥 Smart Data Import
- Template-based import wizard with visual column mapping
- CSV and Excel file support via **PapaParse** and **SheetJS**
- Block selection for partial imports
- Repeat-set controls for batch data entry

---

## 🏗️ Architecture

```
src/
├── components/          # Reusable Vue components
│   ├── board/           #   Kanban board (lists, cards, filters)
│   ├── chart/           #   Chart visualization & regression
│   ├── device/          #   Device CRUD dialogs
│   ├── editor/          #   Rich text editor (Markdown)
│   ├── import/          #   Data import wizard
│   ├── measurement/     #   Measurement CRUD, compare, export
│   ├── reservations/    #   Calendar views & reservation editor
│   └── ui/              #   Shared UI primitives
├── composables/         # Vue composables (reusable logic)
├── layouts/             # Page layout templates
├── models/              # TypeScript data models
├── pages/               # Route-level page components
├── plugins/             # Vuetify & app plugins
├── router/              # Vue Router config with auth guards
├── services/            # API layer & Zenodo integration
├── stores/              # Pinia state management
├── types/               # TypeScript type definitions
├── utils/               # Helper utilities
├── views/               # View-specific logic
└── workers/             # Web Workers for heavy parsing
```

---

## 🧰 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Framework** | [Vue 3](https://vuejs.org/) (Composition API) |
| **Language** | [TypeScript 5.6](https://www.typescriptlang.org/) |
| **UI Library** | [Vuetify 3](https://vuetifyjs.com/) + Material Design Icons |
| **State** | [Pinia](https://pinia.vuejs.org/) |
| **Routing** | [Vue Router 4](https://router.vuejs.org/) (auto-generated routes) |
| **Build** | [Vite 5](https://vitejs.dev/) |
| **Charts** | [Chart.js 4](https://www.chartjs.org/) |
| **Drag & Drop** | [vue-draggable-next](https://github.com/anish2690/vue-draggable-next) |
| **Statistics** | [simple-statistics](https://simplestatistics.org/) |
| **PDF Export** | [jsPDF](https://github.com/parallax/jsPDF) + jspdf-autotable |
| **Data Import** | [PapaParse](https://www.papaparse.com/) (CSV) + [SheetJS](https://sheetjs.com/) (Excel) |
| **Rich Text** | [md-editor-v3](https://github.com/imzbf/md-editor-v3) |
| **Auth** | [Keycloak JS](https://www.keycloak.org/) (SSO / OAuth 2.0) |
| **Testing** | [Vitest](https://vitest.dev/) + [Vue Test Utils](https://test-utils.vuejs.org/) |
| **Deploy** | Docker + Docker Compose + Traefik |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **npm** (comes with Node.js)
- A running backend API (Java-based)
- A [Keycloak](https://www.keycloak.org/) instance for authentication

### Installation

```bash
# Clone the repository
git clone https://github.com/krisssix/lim.git
cd lim

# Install dependencies
npm install

# Configure environment
cp .env-example .env.development.local
```

Edit `.env.development.local` with your backend and auth server URLs:

```env
VITE_SERVER_URL=http://localhost:8080/api
VITE_AUTH_SERVER_URL=https://your-keycloak-server.com
VITE_AUTH_REALM=your-realm
```

### Development

```bash
# Start dev server on http://localhost:3000
npm run dev
```

### Build for Production

```bash
npm run build
```

### Docker Deployment

```bash
docker-compose up --build
```

### Testing

```bash
# Run tests
npm run test

# Watch mode
npm run test:watch
```

---

## 📐 Project Structure Highlights

- **Measurement Templates** — Dynamic form generation from JSON schema (text, number, boolean, date, select, rating fields)
- **Reservation Conflict Engine** — Real-time detection of overlapping reservations with conflict resolution dialog
- **Recurring Events** — Full RFC-5545 inspired recurrence rule support (daily, weekly, monthly, yearly with intervals, end dates, and exception handling)
- **Web Workers** — File parsing offloaded to background threads for smooth UI during large CSV/Excel imports
- **Auto-imports** — Components and APIs are auto-imported via `unplugin-vue-components` and `unplugin-auto-import`

---

## 📎 Documentation & Live Demo

> 📑 **A full interactive presentation with live demonstrations** of the system is available online:
>
> ### [🎬 View Live Presentation →](https://nazarjanova.my.canva.site/lims)
>
> The presentation covers system architecture, feature walk-throughs, and real-time demos of measurements, reservations, and data import workflows.

---

## 👤 Author

**Kristina Nazarjanová**
- 🎓 Master's Student — [Mendel University in Brno](https://mendelu.cz)
- 🐙 GitHub: [@krisssix](https://github.com/krisssix)

---

## 📝 License

This project was developed as part of a university thesis. Please contact the author for usage permissions.

---

<p align="center">
  <sub>Built with ❤️ using Vue 3 + Vuetify + TypeScript</sub>
</p>
