# Crypto Factor

An open library of weekly cryptocurrency factors: eight long-short factor series rebuilt from published research, documented step by step and free to download. A second part gives a market overview that classifies tokens by economic function.

- Static site: Vite + TypeScript, no UI framework. Every text, table, formula and diagram is rendered to HTML at build time, so the page is readable before any JavaScript runs.
- Hosting: Cloudflare Workers (static assets only). The source code lives in this repository.
- Preview: <https://crypto-factor.ccpcudati.workers.dev> (prototype for review, not the final URL).
- English only. No login, no cookies, no analytics.
- Current release: **2026 Q2**, weekly data through 2026-06-14 (493 weeks from the formation week ending 2017-01-01).

> **Status: prototype for review.** The market-overview figures are placeholders transcribed from meeting slides. See [Open items](#open-items).

## Site map

| # | Section | Content |
| --- | --- | --- |
| — | Hero | Every weekly MKT return drawn as a barcode, with the best and worst weeks marked. |
| 01 | Overview | Scrollytelling factor map: the eight factors, each drawn as its fingerprint mark, as a lineup, regrouped by data source, then by theory, then unfolded into 493 weekly returns. |
| 02 | Factors | Catalog on the left, detail on the right: definition, type, frequency, coverage, last update, source paper, six statistics (mean, s.d., t-statistic, annualized Sharpe, min, max), an animated data fingerprint and a log-scale cumulative NAV chart. Each list item carries the factor's fingerprint mark. The list can be grouped by data source or by theory. |
| 03 | Methodology | Construction pipeline, weekly calendar, investable universe (seven rules plus the CoinMarketCap consistency filter), the four sort designs, factor-by-factor formulas and the relation to the MS baseline. |
| 04 | Papers | Paper → factor map (factors drawn as fingerprint marks) and the four source papers with DOI links and a copy-citation button. |
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
| | [YUGOOD515/xjy](https://github.com/YUGOOD515/xjy) | Ported code | Data fingerprint: the contour renderer from `web/fingerprint/render.js` (see below) |
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

## Data fingerprint

Each factor has an animated contour fingerprint. The large version sits in the factor panel and turns with the pointer (on touch screens, with a sideways drag). Everywhere else the factor icon is a small fingerprint, a *mark*: in the overview map, the catalog list, the papers map and the download table. All of them share one clock, so every copy of a factor moves in step, and each pause button (factor panel, overview map, papers map, download table) pauses all of them. With `prefers-reduced-motion` they are drawn once and stay still, and the pause buttons are hidden.

- **Origin:** `src/fingerprint/render.ts` ports `contourPoints()` and `mountFingerprints()` from [YUGOOD515/xjy](https://github.com/YUGOOD515/xjy) `web/fingerprint/render.js` line for line: the same surface, projection, band counts, color stops and pointer handling. The 50 ms frame throttle and the pause switch now live in `src/fingerprint/clock.ts`, shared by every fingerprint on the page. `contourInto()` writes the points into a typed array and takes the sines and cosines that stay constant along a contour once per contour instead of once per point; its output is bit-identical to the original `contourPoints()`. The original's small canvas variant is replaced by the marks; the NFT SVG edition (`fingerprintSVG`) and the WebGL sculpture were not ported.
- **Marks:** `src/fingerprint/mark.ts`. Scaled down to an icon, the 83 bands of the large fingerprint fall less than a pixel apart and merge into a blur, so a mark is drawn like a mipmapped texture, with band counts chosen from its size on screen: a body of dense bands about 1.1 px apart at 30 % opacity keeps the shape and its average color, and on top as many bands as fit about 3 px apart keep the contour lines legible. Marks redraw every 200 ms, since at that size the lines move only about a third of a pixel per second. The overview and papers maps paint their marks on one canvas under the SVG and follow the SVG's transitions frame by frame.
- **Badges:** the category glyph of the earlier icons (square = trading data, circle = on-chain data; filled = risk factor, outline = behavioral factor) sits in the bottom-right corner of every mark. Legends and tags keep the glyph alone. Without JavaScript the badges stay and the canvases are hidden.
- **Mapping:** `src/fingerprint/data.ts` replaces the original `visualParameters()`.

| Parameter | Factor input | Value |
| --- | --- | --- |
| hue | data source | trading 215, on-chain 32 (the original's ETH and BTC hues, about 180° apart) |
| mood | annualized Sharpe ratio | min–max over the eight factors → 0 … 1 |
| roughness | standard deviation of weekly returns | min–max → 0.08 … 0.85 |
| activity | \|t\|-statistic | min–max → 0.1 … 1 |
| seed | factor ID | position in the sorted IDs × 2π / 8 |

- **Normalization:** the original divided by fixed constants (sentiment / 100, amplitude / 15, log10(volume) / 12). Here the lowest of the eight factors maps to the lower bound of the renderer's original range and the highest to the upper bound. The ranges are the bounds the original clamps to. The fingerprints are therefore relative to this set of factors and change slightly when a release changes the statistics.
- **Seed:** the original seed (sum of character codes / 100) would give MKT, SMB and MOM almost the same phase (2.36, 2.26 and 2.33 rad), so the sorted IDs are spaced evenly over one period instead.

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
  fingerprint/*.ts              data fingerprint: parameter mapping, shared clock, canvas renderer ported from xjy, marks
  styles/*.css                  tokens, base, layout, components, sections, fingerprint, market, motion
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
npm run typecheck  # build data, then type-check the site and the Vite config
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
4. Commit and push to `main`, then deploy (see below). Once Workers Builds is connected, every push to `main` deploys automatically.

## Deployment (Cloudflare Workers)

- **Current deployment:** Worker `crypto-factor` on workers.dev, <https://crypto-factor.ccpcudati.workers.dev>. It was uploaded directly; the Git integration is not connected yet.
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
- **数据指纹**：每个因子都有一枚动态数字指纹。因子详情中为大图，可随鼠标转动；其余位置（总览图、因子列表、论文关系图、下载表）原来的图标都换成了小指纹，右下角保留小的分类符号（方形 = 交易数据，圆形 = 链上数据；实心 = 风险因子，空心 = 行为因子），图例和标签仍只用符号。小指纹按屏幕尺寸采用类似 mipmap 的两层画法：一层间距约 1.1 px、30% 透明度的密集线条保留形状和平均颜色，上面一层间距约 3 px 的线条保证纹理清晰。所有指纹共用一个时钟，同一因子的各个副本同步运动；页面上任一暂停按钮（因子详情、总览图、论文关系图、下载表）都会暂停全部指纹；系统设置为“减少动态效果”时只绘制一次静止画面。渲染代码移植自 YUGOOD515/xjy 的 `web/fingerprint/render.js`，大图与原版逐点一致；色相 = 数据来源（交易 215 / 链上 32），mood = 年化 Sharpe，roughness = 标准差，activity = |t|，seed = 因子 ID。各项统计量在 8 个因子之间做 min–max 归一化，映射到原版渲染器的取值范围。
- **预览地址**：<https://crypto-factor.ccpcudati.workers.dev>（审核用原型，不是正式网址）。
- **季度更新**：运行 `python3 scripts/import_xlsx_release.py bundle.xlsx 2026Q3 --latest`，然后 `npm run build` 并推送到 `main`，再部署。在 Cloudflare 连接 Workers Builds 之后，推送到 `main` 就会自动部署。历史版本保留在 `data/releases/`，网站只提供最新版下载。
- **待确认事项**：市场总览目前为占位数据；PL、PR 定义待确认；币种—类别 0/1 对照表尚未提供；数据许可与引用格式为草案；NTU 表述、logo 和网站正式网址待定；上线前由赵老师与 NTU 负责人确认。
