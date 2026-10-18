import { $, $$ } from '../lib/dom';
import { data } from '../lib/data';
import { isMotionPaused, setMotionPaused } from '../fingerprint/clock';
import { mountMarks } from '../fingerprint/mark';
import { mountFingerprints } from '../fingerprint/render';

/**
 * Data fingerprints: the large, pointer-driven one in the hero and in every
 * factor panel, and the still marks that stand in for factor icons in the
 * catalog list and the download table (the overview and papers maps mount
 * their own, see mountMarkLayer). Each tab mounts its own the first time it
 * is shown; the still marks only draw once on screen, so they mount at once.
 */

/** The hero's sits behind the title, so it follows the pointer over the whole
 * hero; it is always in view on arrival, so it comes to rest after a moment. */
export function initHeroFingerprint(): void {
  const hero = $('#top');
  if (hero && $('canvas[data-factor]', hero)) mountFingerprints(hero, data.factors, { pointerArea: hero, settle: true });
}

/** The factor panels' fingerprints. The pause button in each panel's toolbar
 * drives all of them, as the single switch did in the original. */
export function initCatalogFingerprints(): void {
  const root = $('#factors');
  if (root && $('canvas[data-factor]', root)) mountFingerprints(root, data.factors);

  const buttons = $$<HTMLButtonElement>('[data-fp-motion]');
  const sync = () => {
    const paused = isMotionPaused();
    for (const button of buttons) {
      // U+FE0E keeps ▶ from turning into an emoji on iOS.
      button.textContent = paused ? '\u25B6\uFE0E' : 'Ⅱ';
      const label = paused ? 'Play animation' : 'Pause animation';
      button.setAttribute('aria-label', label);
      button.title = label;
    }
  };
  for (const button of buttons) {
    button.addEventListener('click', () => {
      setMotionPaused(!isMotionPaused());
      sync();
    });
  }
  sync();
}

export function initMarks(): void {
  mountMarks(document, data.factors);
}
