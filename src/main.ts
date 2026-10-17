import '@fontsource-variable/inter';
import 'uplot/dist/uPlot.min.css';
import 'lenis/dist/lenis.css';
import './generated/katex.css';
import './styles/main.css';

import { $, whenNear } from './lib/dom';
import { initReveal } from './lib/motion';
import { initSmoothScroll } from './lib/scroll';
import { initTheme } from './lib/theme';
import { initCatalog } from './sections/catalog';
import { initDownload } from './sections/download';
import { initFingerprints } from './sections/fingerprints';
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
safely('hero', initHero);
safely('overview', initOverview);
safely('catalog', initCatalog);
safely('fingerprints', initFingerprints);
safely('methodology', initMethodology);
safely('papers', initPapers);
safely('download', initDownload);
safely('reveal', initReveal);

// Part II (physics, morphing charts) ships as its own chunk and only loads
// when the reader approaches it.
const market = $('#market');
if (market) {
  whenNear(
    market,
    () => {
      import('./sections/market')
        .then(({ initMarket }) => safely('market', initMarket))
        .catch((error) => console.error('[crypto-factor] market chunk failed to load', error));
    },
    '600px 0px',
  );
}
