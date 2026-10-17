import { animate, stagger } from 'motion';
import { $, $$ } from '../lib/dom';
import { EASE_OUT, reducedMotion } from '../lib/motion';
import { focusTarget, lockScroll, onScroll, scrollToTarget } from '../lib/scroll';

/** Header: reading progress, scroll-spy, in-page anchors and the mobile menu. */
export function initHeader(): void {
  initProgress();
  initScrollSpy();
  initAnchors();
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
  update();
}

function initScrollSpy(): void {
  const links = new Map($$<HTMLAnchorElement>('[data-nav]').map((a) => [a.dataset.nav ?? '', a]));
  const sections = $$('main > section[id]');
  let active = '';
  const setActive = (id: string) => {
    if (id === active) return;
    active = id;
    for (const [key, link] of links) {
      const on = key === id;
      link.classList.toggle('is-active', on);
      if (on) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
  };
  // A one-pixel line 40% down the viewport: whichever section crosses it is current.
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) setActive((entry.target as HTMLElement).dataset.section ?? '');
      }
    },
    { rootMargin: '-40% 0px -60% 0px' },
  );
  sections.forEach((s) => io.observe(s));
}

function initAnchors(): void {
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!link) return;
    const hash = link.getAttribute('href') ?? '';
    if (hash === '#') return;
    const id = decodeURIComponent(hash.slice(1));
    const target = id === 'top' ? null : document.getElementById(id);
    if (id !== 'top' && !target) return;
    event.preventDefault();
    if (id === 'main' && target) {
      focusTarget(target);
      scrollToTarget(target);
      return;
    }
    history.pushState(null, '', id === 'top' ? location.pathname + location.search : hash);
    if (!target) {
      scrollToTarget('top', () => $<HTMLAnchorElement>('.brand')?.focus({ preventScroll: true }));
      return;
    }
    scrollToTarget(target, () => focusTarget(target));
  });
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