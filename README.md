# Crypto Factor

An open library of weekly cryptocurrency factors: eight long-short factor series rebuilt from published research, documented step by step and free to download. A second part gives a market overview that classifies tokens by economic function.

- Static site: Vite + TypeScript, no UI framework. Every text, table, formula and diagram is rendered to HTML at build time, so the page is readable before any JavaScript runs.
- Hosting: Cloudflare Workers (static assets only). The source code lives in this repository.
- English only. No login, no cookies, no analytics.
- Current release: **2026 Q2**, weekly data through 2026-06-14 (493 weeks from the formation week ending 2017-01-01).

> **Status: prototype for review.** The market-overview figures are placeholders transcribed from meeting slides. See [Open items](#open-items).

## Site map

| # | Section | Content |
| --- | --- | --- |
| — | Hero | Every weekly MKT return drawn as a barcode, with the best and worst weeks marked. |
| 01 | Overview | Scrollytelling factor map: the eight factors as a lineup, regrouped by data source, then by theory, then unfolded into 493 weekly returns. |
| 02 | Factors | Catalog on the left, detail on the right: definition, type, frequency, coverage, last update, source paper, six statistics (mean, s.d., t-statistic, annualized Sharpe, min, max) and a log-scale cumulative NAV chart. The list can be grouped by data source or by theory. |
| 03 | Methodology | Construction pipeline, weekly calendar, investable universe (seven rules plus the CoinMarketCap consistency filter), the four sort designs, factor-by-factor formulas and the relation to the MS baseline. |
| 04 | Papers | Paper → factor map and the four source papers with DOI links and a copy-citation button. |
| 05 | Download | All-factors ZIP and single-factor ZIPs (CSV + data dictionary + license + citation), data dictionary, license and citation (text / BibTeX). Only the latest release is offered. |
| 06 | Market overview | 629 tokens dropped into four category bins, share of tokens vs. market value (bars ↔ ring), active-address index (2018 = 100), category cards and the token → category table (pending). |

## Design

The style follows **[capsrock/bauhaus-design-skill](https://github.com/capsrock/bauhaus-design-skill)**: Bauhaus and Swiss International Style, with a strict grid, flat color and geometric shapes that carry meaning. Grid and typography rules come from [peterhadorn/swiss-design-skill](https://github.com/peterhadorn/swiss-design-skill), and diagrams follow [diagram-design](https://github.com/cathrynlavery/diagram-design).

- **Part I (factor data):** Swiss International Style. Warm paper, black ink and a single red accent. Inter Variable with tabular figures, a perfect-fourth type scale, a 12-column grid, flush-left text and hairline rules. Shape encodes data source (square = trading data, circle = on-chain) and fill encodes theory (filled = risk, outline = behavioral).
- **Part II (market overview):** an explicit Bauhaus homage. Red, blue and yellow primaries on black, with one shape per category (square GP, circle PL, triangle PR, diamond SE).
- **Motion:** flat and narrative. Each transition explains a change in the data (regroup, unfold, fill, morph) and is never decoration only. All motion respects `prefers-reduced-motion`.

## Inspiration library: projects used per section

Every project below comes from the team's visual inspiration library. "Dependency" means the library ships in the bundle; "Reference" means its patterns were followed without importing code.

| Section | Project | Role | Used for |
| --- | --- | --- | --- |
| 01 Overview | [Scrollama](https://github.com/russellsamora/scrollama) | Dependency | Step triggers for the four-step story |
| | [GSAP](https://github.com/greensock/GSAP) (+ ScrollTrigger) | Dependency | Tweening the factor map between states, scroll progress bar |
| | [Lenis](https://github.com/darkroomengineering/lenis) | Dependency | Smooth scrolling and anchor scrolls (off for reduced motion) |
| 02 Factors | [uPlot](https://github.com/leeoniya/uPlot) | Dependency | Log-scale NAV chart of the selected factor against the other seven, with hover readout |
| | [anime.js](https://github.com/juliangarnier/anime) | Dependency | Statistic count-up and the factor-code letter rise (also the hero sweep) |
| | [Inter](https://github.com/rsms/inter) | Dependency | Tabular figures for statistics and tables |
| 03 Methodology | [diagram-design](https://github.com/cathrynlavery/diagram-design) | Reference | Calendar, filter and sort diagrams: restrained SVG with no shadows, on a 4 px grid |
| | [tufte-css](https://github.com/edwardtufte/tufte-css) | Reference | Numbered side notes beside the text |
| 04 Papers | [D3](https://github.com/d3/d3) | Dependency | Paper → factor map with hover/focus highlighting linked to the paper cards |
| | [Motion](https://github.com/motiondivision/motion) | Dependency | Copy-citation feedback, menu and reveal micro-interactions |
| 05 Download | [Motion](https://github.com/motiondivision/motion) | Dependency | Download progress bar and check-mark confirmation |
| | [Uiverse](https://github.com/uiverse-io/galaxy) | Reference | Button and segmented-control patterns |
| 06 Market overview | [Matter.js](https://github.com/liabru/matter-js) | Dependency | 629 token shapes falling into four category bins |
| | [flubber](https://github.com/veltman/flubber) | Dependency | Shape morph between the bar chart and the ring chart |
| | [D3](https://github.com/d3/d3) | Dependency | Share chart, active-address index chart, tooltip and keyboard reading |
| | [anime.js](https://github.com/juliangarnier/anime) | Dependency | Part II cover: the square slides in, the circle grows and the triangle drops |

Supporting tools that are not in the library: [KaTeX](https://github.com/KaTeX/KaTeX) renders formulas at build time, [fflate](https://github.com/101arrowz/fflate) builds the download ZIPs at build time, and the toolchain uses Vite, TypeScript and Wrangler. The market section is a lazy-loaded chunk.

## Repository layout

```
data/
  releases/manifest.json        latest release id and release history
  releases/2026Q2/              one folder per quarterly release (kept for history)
    release.json                per-factor ids, coverage and row counts
    factors/*.csv               long format, one file per factor, plus ALL_FACTORS_WIDE.csv
    market/token-classification-market-overview.json   market-overview figures (prototype)
  meta/                         factors.json (texts, formulas, papers), papers.json, market.json, data-dictionary.csv
  legal/                        LICENSE-DATA.txt (draft), CITATION.txt
  market/                       token-category-map.template.csv (add token-category-map.csv when delivered)
scripts/
  import_xlsx_release.py        xlsx bundle → data/releases/<id>/
  build-data.mjs                data → src/generated/* (site data + HTML partials) and public/downloads/*.zip
src/
  main.ts                       entry: fonts, styles, section initializers (market chunk lazy-loaded)
  sections/*.ts                 one module per section
  lib/*.ts                      data access, DOM helpers, motion and scroll utilities
  styles/*.css                  tokens, base, layout, components, sections, market, motion
index.html                      page skeleton; <!-- partial:* --> markers are filled at build time
public/                         _headers (CSP, caching), 404.html, robots.txt, favicon
wrangler.jsonc                  Cloudflare Workers static-assets configuration
```

`src/generated/` and `public/downloads/` are build outputs and are not committed.

## Development

Requirements: Node ≥ 20.19. Importing a release also needs Python 3 with `openpyxl`.

```bash
npm install
npm run dev        # build data, then start the Vite dev server
npm run build      # build data, then the production build in dist/
npm run preview    # serve dist/ locally
npm run typecheck  # build data, then type-check
```

## Quarterly update

Data is updated every quarter (for example, in July with data through the end of June). Every release stays in `data/releases/`, but the site publishes only the release marked `latest`.

1. Import the new workbook:
   ```bash
   python3 scripts/import_xlsx_release.py path/to/bundle.xlsx 2026Q3 --latest
   ```
   This writes `data/releases/2026Q3/` and marks it as latest in `manifest.json`.
2. If needed, update the texts in `data/meta/`, the market file in `data/releases/<id>/market/`, or add `data/market/token-category-map.csv`. Once that CSV exists, the download card switches from "Pending" to "Available" automatically. The build checks the header and makes sure each token has exactly one category.
3. Run `npm run build`, then check the result with `npm run preview`.
4. Commit and push to `main`. Cloudflare Workers Builds deploys the site.

## Deployment (Cloudflare Workers)

- **Workers Builds (Git integration):** connect this repository, then set the build command to `npm run build` and the deploy command to `npx wrangler deploy`.
- **Or from a machine:** run `npx wrangler login`, then `npm run deploy`.

The site uses static assets only, with no Worker script. `public/_headers` sets a strict Content-Security-Policy and the cache rules.

## Open items

- **Market data is a placeholder:** counts, market values and activity paths come from meeting slides, and the activity paths are interpolated annual values. Replace them with the final dataset.
- **Category definitions:** the Platform (PL) and Product (PR) definitions still need confirmation.
- **Token → category 0/1 table:** not delivered yet. The template is in `data/market/`.
- **License and citation:** the data license (CC BY 4.0 proposed) and the citation text are drafts. The NTU wording, logo and final site URL (used in the citation) also need confirmation.
- **Launch review:** Prof. Zhao and the NTU lead review the site before launch. NTU will link to the site from its research-institute website, but the site runs independently.
- **Code license:** not chosen yet (`package.json` says `UNLICENSED`).

## 中文说明

- **网站结构**：第一部分为因子数据（总览、因子目录与详情、方法论、论文、下载），第二部分为市场总览。仅英文，无需登录，不使用 cookie。
- **风格**：采用 bauhaus-design-skill（包豪斯 / 瑞士国际主义风格）。因子部分为纸色、墨黑加一个红色强调色；市场部分在黑底上使用红、蓝、黄三原色，并以几何形状代表四个类别。
- **季度更新**：运行 `python3 scripts/import_xlsx_release.py bundle.xlsx 2026Q3 --latest`，然后 `npm run build` 并推送到 `main`，Cloudflare 会自动部署。历史版本保留在 `data/releases/`，网站只提供最新版下载。
- **待确认事项**：市场总览目前为占位数据；PL、PR 定义待确认；币种—类别 0/1 对照表尚未提供；数据许可与引用格式为草案；NTU 表述、logo 和网站正式网址待定；上线前由赵老师与 NTU 负责人确认。
