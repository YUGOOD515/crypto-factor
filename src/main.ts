import '@fontsource-variable/inter';
import 'uplot/dist/uPlot.min.css';
import 'lenis/dist/lenis.css';
import './generated/katex.css';
import './styles/main.css';

import { initSmoothScroll } from './lib/scroll';
import { initTabs, onFirstShow, onIntent } from './lib/tabs';
import { initTheme } from './lib/theme';
import { initCatalog } from './sections/catalog';
import { initDownload } from './sections/download';
import { initCatalogFingerprints, initHeroFingerprint, initMarks } from './sections/fingerprints';
import { initHeader } from './sections/header';
import { initHero } from './sections/hero';
import { initMethodology } from './sections/methodology';
import { initOverview } from './sections/overview';
import { initPapers } from './sections/papers';

document.documentElement.classList.add('js');

/** Run one section initialiser without letting a failure take the page down. */
function safely(name: string, init: () => void): void {
  try {
    init();
  } catch (error) {
    console.error(`[crypto-factor] ${name} failed to initialise`, error);
  }
}

safely('theme', initTheme);
safely('smooth scroll', initSmoothScroll);
safely('header', initHeader);
// Site-wide: download and copy buttons sit in several tabs; the still
// fingerprint marks only draw once they are on screen.
safely('download', initDownload);
safely('marks', initMarks);

// Everything else runs the first time its tab is shown (src/lib/tabs.ts).
onFirstShow('overview', () => {
  safely('hero', initHero);
  safely('hero fingerprint', initHeroFingerprint);
  safely('overview', initOverview);
});
onFirstShow('factors', () => {
  safely('catalog', initCatalog);
  safely('catalog fingerprints', initCatalogFingerprints);
});
onFirstShow('methodology', () => safely('methodology', initMethodology));
onFirstShow('papers', () => safely('papers', initPapers));

// Part II (physics, morphing charts) ships as its own chunk: fetched when the
// reader heads for the Market tab, run when it opens.
let market: Promise<typeof import('./sections/market')> | null = null;
const loadMarket = () => {
  market ??= import('./sections/market');
  return market;
};
onIntent('market', () => {
  loadMarket().catch(() => {
    market = null; // try again when the tab opens
  });
});
onFirstShow('market', () => {
  loadMarket()
    .then(({ initMarket }) => safely('market', initMarket))
    .catch((error) => console.error('[crypto-factor] market chunk failed to load', error));
});

safely('tabs', initTabs);
