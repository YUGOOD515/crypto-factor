import { animate, stagger } from 'motion';
import { $, $$ } from '../lib/dom';
import { EASE_OUT, reducedMotion } from '../lib/motion';
import { lockScroll, onScroll } from '../lib/scroll';

/**
 * Header: reading progress and the mobile menu. The current-tab state of the
 * nav links and every in-page link are handled by src/lib/tabs.ts.
 */
export function initHeader(): void {
  initProgress();
  initMenu();
}

function initProgress(): void {
  const bar = $('[data-progress]');
  if (!bar) return;
  const update = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
    bar.style.transform = `scaleX(${p.toFixed(4)})`;
  };
  onScroll(update);
  window.addEventListener('resize', update);
  // Progress through the current tab, whose length changes with it.
  document.addEventListener('cf:tab', update);
  update();
}

function initMenu(): void {
  const button = $<HTMLButtonElement>('[data-menu-btn]');
  const menu = $('[data-menu]');
  if (!button || !menu) return;
  const label = $('.menu-btn__label', button);
  const outside = [$('main'), $('.site-footer'), $('.skip-link')].filter(Boolean) as HTMLElement[];
  let open = false;

  const setOpen = (next: boolean, restoreFocus = true) => {
    if (next === open) return;
    open = next;
    button.setAttribute('aria-expanded', String(next));
    if (label) label.textContent = next ? 'Close' : 'Menu';
    for (const el of outside) el.inert = next;
    lockScroll(next);
    if (next) {
      menu.hidden = false;
      const links = $$('a, .eyebrow, .seg', menu);
      if (!reducedMotion()) {
        animate(menu, { opacity: [0, 1] }, { duration: 0.25 });
        animate(
          links,
          { opacity: [0, 1], transform: ['translateY(24px)', 'translateY(0px)'] },
          { duration: 0.6, delay: stagger(0.045), ease: EASE_OUT },
        );
      }
      $<HTMLAnchorElement>('a', menu)?.focus();
    } else {
      menu.hidden = true;
      if (restoreFocus) button.focus();
    }
  };

  button.addEventListener('click', () => setOpen(!open));
  menu.addEventListener('click', (event) => {
    if ((event.target as Element).closest('a')) setOpen(false, false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) setOpen(false);
  });
  window.matchMedia('(min-width: 1280px)').addEventListener('change', (event) => {
    if (event.matches) setOpen(false, false);
  });
}