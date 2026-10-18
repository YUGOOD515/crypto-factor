import { animate } from 'motion';
import { $, $$ } from '../lib/dom';
import { EASE_OUT, reducedMotion } from '../lib/motion';
import { initSeg } from '../lib/seg';
import type { TargetDetail } from '../lib/tabs';

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

  // Links and deep links to #method-SMB open that tab (src/lib/tabs.ts asks
  // once this tab is on screen) and land on the tab bar above it.
  document.addEventListener('cf:target', (event) => {
    const detail = (event as CustomEvent<TargetDetail>).detail;
    const code = detail.id.match(/^method-(.+)$/)?.[1];
    if (!code || !panels.some((p) => p.id === detail.id)) return;
    seg.set(code, { silent: true });
    show(code);
    detail.scroll = $('#m-factors') ?? detail.scroll;
  });
}
