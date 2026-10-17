import { $, $$ } from '../lib/dom';
import { data } from '../lib/data';
import { isMotionPaused, setMotionPaused } from '../fingerprint/clock';
import { mountMarks } from '../fingerprint/mark';
import { mountFingerprints } from '../fingerprint/render';

/**
 * Data fingerprints: the large, pointer-driven one in every factor panel and
 * the marks that stand in for factor icons in the catalog list and the
 * download table (the overview and papers maps mount their own, see
 * mountMarkLayer). Every pause button on the page drives all of them, as the
 * single switch did in the original.
 */
export function initFingerprints(): void {
  const root = $('#factors');
  if (root && $('canvas[data-factor]', root)) mountFingerprints(root, data.factors);
  mountMarks(document, data.factors);

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
