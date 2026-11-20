# Paper Packer

An Angular research workspace for finding open scientific papers through CORE.
Search with keywords or Boolean expressions, choose how many papers to retrieve,
and explore publication-year counts across the full query.

## Requirements

- Node.js 22.12+ in the 22.x line, or Node.js 24.x; npm 10+.
- A modern browser and network access to CORE. CORE may require a VPN in some environments.
- Angular 21.2 (the project requires Angular 20 or higher).

The anonymous access path requires no API key or server. Never include a private
CORE key in Angular source, environment configuration, or browser requests.

## Install and run

```sh
nvm use
npm ci
npm start
```

Open <http://127.0.0.1:4200/>. Without nvm, install a supported Node version and
skip `nvm use`. Stop the development server with Ctrl+C.

## Verify and build

```sh
npm run verify
```

This runs the automated tests, strict Angular checks, a production build, and
checks the generated browser output. It does not make live CORE requests. For
individual steps, use `npm test`, `npm run build`, or `npm run build:dev`.

Production files are in `dist/paper-packer/browser/`. Serve that directory from a
static HTTPS host at the site root. Query sharing uses URL parameters rather than
nested routes; subdirectory hosting requires configuring the base URL before
building.

## Use the workspace

1. Enter keywords or a Boolean query such as `(drone AND (package OR delivery))`.
2. Use uppercase AND, OR, and NOT, parentheses, and quoted phrases. CORE remains
   authoritative for its search syntax.
3. Choose a whole-number paper count from 1 to 100 and select **Find papers**.
4. Review paper titles, authors, years, abstracts, and available CORE/full-text
   links. The returned papers and full query total are shown separately.
5. Explore the publication-year chart and its **View year data** table. Changing
   only the paper count reuses query-wide year data.
6. Use **Copy search link** to share the submitted query and count. **Search guide**
   provides examples and can fill the query without submitting it.

## Publication-year coverage

The app requests year aggregations for the full query, independently of the
paper-card limit. It checks year totals against CORE's full query total and labels
incomplete coverage. Any difference is shown as **Not covered by year buckets**;
it is not evidence that the unaccounted papers have missing publication years.

For the supplied Boolean example, CORE returned 71,213 matches while its year
aggregation accounted for 68,719. Full year coverage remains unresolved, so the
app does not present that distribution as complete.

## Features

- Boolean-search guide, input validation, and shareable query/count URLs.
- Configurable paper count, readable paper metadata, and expandable abstracts.
- Query-wide publication-year chart with a matching accessible data table.
- Independent chart retry, stale-request cancellation, and complete-result local
  aggregation when all matching papers are available.
- Keyboard navigation, visible focus, reduced-motion support, and responsive layouts.

## Project layout

```text
public/                 Static assets
src/app/data/           CORE integration, normalization, and search/chart state
src/app/papers/         Paper cards
src/app/charts/         Publication-year chart and data table
src/app/                App shell and search interface
tests/                  Contract and controller tests
scripts/                Test runner and production-output checks
```