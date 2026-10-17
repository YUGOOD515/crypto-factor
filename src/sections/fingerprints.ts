import { $, $$ } from '../lib/dom';
import { data } from '../lib/data';
import { isMotionPaused, mountFingerprints, setMotionPaused } from '../fingerprint/render';

/**
 * Data fingerprints in the factor catalog: a thumbnail in every list item and
 * a large, pointer-driven one in every factor panel. One pause switch drives
 * all of them, as in the original.
 */
export function initFingerprints(): void {
  const root = $('#factors');
  if (!root || !$('canvas[data-factor]', root)) return;
  mountFingerprints(root, data.factors);

  const buttons = $$<HTMLButtonElement>('[data-fp-motion]', root);
  const sync = () => {
    const paused = isMotionPaused();
    for (const button of buttons) {
      // U+FE0E keeps ▶ from turning into an emoji on iOS.
      button.textContent = paused ? '\u25B6\uFE0E' : 'Ⅱ';
      button.setAttribute('aria-label', paused ? 'Play animation' : 'Pause animation');
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
