import { animate, inView, stagger } from 'motion';
import { $$ } from './dom';

const query = window.matchMedia('(prefers-reduced-motion: reduce)');

export function reducedMotion(): boolean {
  return query.matches;
}

export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const EASE_IN_OUT: [number, number, number, number] = [0.65, 0, 0.35, 1];

interface RevealGroup {
  container: Element;
  items: HTMLElement[];
}

function groups(root: ParentNode): RevealGroup[] {
  const out: RevealGroup[] = [];
  const add = (containerSelector: string, itemSelector?: string) => {
    for (const container of $$(containerSelector, root)) {
      const items = itemSelector ? $$(itemSelector, container) : [container];
      if (items.length) out.push({ container, items });
    }
  };
  add('.section-head', ':scope > .section-index, .eyebrow, .section-title, .section-lede');
  add('.hero__facts .facts', '.fact');
  add('.pipeline', '.pipeline__node');
  add('.method-block');
  add('.papers', '.paper');
  add('.release-strip', ':scope > div');
  add('.dl-grid', ':scope > div');
  add('.dl-docs', '.dl-doc');
  add('.part__inner', ':scope > *');
  add('.mblock__head', ':scope > *');
  add('.mcats', '.mcat');
  return out;
}

/**
 * Fade-and-rise entrance for content below the fold, within `root` (each tab
 * sets up its own the first time it is shown). Content that is already on
 * screen at that point is left untouched, so nothing flashes.
 */
export function initReveal(root: ParentNode = document): void {
  if (reducedMotion()) return;
  const limit = window.innerHeight * 0.92;
  for (const { container, items } of groups(root)) {
    if (container.getBoundingClientRect().top < limit) continue;
    for (const el of items) {
      el.style.opacity = '0';
      el.style.transform = 'translateY(28px)';
    }
    const stop = inView(
      container,
      () => {
        stop();
        animate(
          items,
          { opacity: [0, 1], transform: ['translateY(28px)', 'translateY(0px)'] },
          { duration: 0.8, delay: stagger(0.07), ease: EASE_OUT },
        ).then(() => {
          for (const el of items) {
            el.style.removeProperty('opacity');
            el.style.removeProperty('transform');
          }
        });
      },
      { amount: 0.12 },
    );
  }
}