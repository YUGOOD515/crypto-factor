import { animate } from 'motion';
import { $, $$ } from '../lib/dom';
import { announce, copyText, flashButton } from '../lib/feedback';
import { EASE_OUT, reducedMotion } from '../lib/motion';
import { initSeg } from '../lib/seg';

/** 05 Download: download-button feedback, citation tabs and copy buttons (site-wide). */
export function initDownload(): void {
  initDownloadButtons();
  initCitationTabs();
  initCopy();
}

function initDownloadButtons(): void {
  for (const link of $$<HTMLAnchorElement>('a[data-download]')) {
    link.addEventListener('click', () => {
      const button = link.classList.contains('btn') ? link : $('.btn', link);
      if (!button || button.classList.contains('is-busy')) return;
      const file = link.getAttribute('href')?.split('/').pop() ?? 'file';
      announce(`Downloading ${file}`);
      if (reducedMotion()) {
        flashButton(button, 'Downloaded', 2200);
        return;
      }
      let bar = $('.btn__progress', button);
      if (!bar) {
        bar = document.createElement('span');
        bar.className = 'btn__progress';
        bar.setAttribute('aria-hidden', 'true');
        button.append(bar);
      }
      button.classList.add('is-busy');
      bar.style.opacity = '1';
      animate(bar, { transform: ['scaleX(0)', 'scaleX(1)'] }, { duration: 0.7, ease: EASE_OUT })
        .then(() => {
          flashButton(button, 'Downloaded', 2200);
          return animate(bar, { opacity: [1, 0] }, { duration: 0.3, delay: 0.15 });
        })
        .then(() => {
          bar.style.transform = 'scaleX(0)';
          button.classList.remove('is-busy');
        });
    });
  }
}

function initCitationTabs(): void {
  const tabs = $('[data-cite-tabs]');
  if (!tabs) return;
  const panels = { text: $('#cite-text'), bib: $('#cite-bib') };
  initSeg(tabs, (value) => {
    if (panels.text) panels.text.hidden = value !== 'text';
    if (panels.bib) panels.bib.hidden = value !== 'bib';
  });
}

function initCopy(): void {
  document.addEventListener('click', async (event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-copy], [data-copy-target]');
    if (!button) return;
    let text = button.dataset.copy ?? '';
    if (button.dataset.copyTarget === 'cite') {
      text = $('#cite-text:not([hidden]), #cite-bib:not([hidden])')?.textContent ?? '';
    }
    text = text.trim();
    if (!text) return;
    const ok = await copyText(text);
    flashButton(button, ok ? 'Copied' : 'Copy failed');
    announce(ok ? 'Citation copied to the clipboard' : 'Could not copy. Select the text and copy it manually.');
  });
}