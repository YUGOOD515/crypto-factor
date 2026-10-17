import { animate } from 'motion';
import { $, $$ } from '../lib/dom';
import { EASE_OUT, reducedMotion } from '../lib/motion';
import { initSeg } from '../lib/seg';

/** 03 Methodology: factor-by-factor construction tabs. */
export function initMethodology(): void {
  const tabs = $('[data-method-tabs]');
  const host = $('[data-method-panels]');
  if (!tabs || !host) return;
  const panels = $$('.method-panel', host);

  const show = (code: string) => {
    for (const panel of panels) {
      const on = panel.id === `method-${code}`;
      panel.hidden = !on;
      if (on && !reducedMotion()) {
        animate(panel, { opacity: [0, 1], transform: ['translateY(10px)', 'translateY(0px)'] }, { duration: 0.45, ease: EASE_OUT });
      }
    }
  };

  const seg = initSeg(tabs, show);

  document.addEventListener('cf:method', (event) => {
    const code = (event as CustomEvent<string>).detail;
    seg.set(code, { silent: true });
    show(code);
  });

  // Deep link: #method-SMB opens that tab.
  const fromHash = location.hash.match(/^#method-(.+)$/)?.[1];
  if (fromHash && panels.some((p) => p.id === `method-${fromHash}`)) {
    seg.set(fromHash, { silent: true });
    show(fromHash);
  }
}