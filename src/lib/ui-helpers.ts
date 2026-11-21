// Kleine, app-weite Helfer, die beim Start einmal eingerichtet werden.

/** Strg+Mausrad und Strg +/−/0 sollen nie die ganze App vergrößern.
 *  (In Text-Dokumenten zoomt Strg+Mausrad weiterhin nur die Seiten – das regelt PagedDoc selbst.) */
function blockAppZoom() {
  window.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey) e.preventDefault();
    },
    { passive: false },
  );
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (['+', '-', '=', '0'].includes(e.key) || ['NumpadAdd', 'NumpadSubtract', 'Numpad0'].includes(e.code)) e.preventDefault();
  });
}

/** Eigene Tooltips statt der Browser-Tooltips (title=…): der erste erscheint nach kurzer Pause,
 *  alle weiteren sofort, solange man von Knopf zu Knopf fährt. */
function quickTooltips() {
  const FIRST_DELAY = 550;
  const NEXT_DELAY = 60;
  const WARM_MS = 1200; // so lange nach dem letzten Tooltip gelten die nächsten als "schnell"

  const tip = document.createElement('div');
  tip.className = 'app-tip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);

  let target: HTMLElement | null = null;
  let timer = 0;
  let shown = false;
  let lastHidden = 0;

  const hide = () => {
    window.clearTimeout(timer);
    if (shown) lastHidden = Date.now();
    shown = false;
    target = null;
    tip.classList.remove('show');
  };

  const place = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    const m = 6;
    let top = r.bottom + m;
    if (top + t.height > window.innerHeight - 4) top = r.top - t.height - m;
    let left = r.left + r.width / 2 - t.width / 2;
    left = Math.max(4, Math.min(left, window.innerWidth - t.width - 4));
    tip.style.top = `${Math.max(4, top)}px`;
    tip.style.left = `${left}px`;
  };

  const show = (el: HTMLElement) => {
    const text = el.dataset.tip;
    if (!text || !el.isConnected) return;
    tip.textContent = text;
    tip.style.top = '-9999px';
    tip.style.left = '-9999px';
    tip.classList.add('show');
    place(el);
    shown = true;
  };

  document.addEventListener('pointerover', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = (e.target as Element | null)?.closest?.<HTMLElement>('[title], [data-tip]') ?? null;
    if (el === target) return;
    // Browser-Tooltip abschalten: title -> data-tip (Name für Screenreader bleibt erhalten).
    if (el?.hasAttribute('title')) {
      const t = el.getAttribute('title') ?? '';
      el.removeAttribute('title');
      if (t) {
        el.dataset.tip = t;
        if (!el.hasAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', t);
      }
    }
    const wasShown = shown;
    hide();
    if (!el || !el.dataset.tip) return;
    target = el;
    const warm = wasShown || Date.now() - lastHidden < WARM_MS;
    timer = window.setTimeout(() => target === el && show(el), warm ? NEXT_DELAY : FIRST_DELAY);
  });
  document.addEventListener('pointerout', (e) => {
    if (!target) return;
    const to = e.relatedTarget as Node | null;
    if (to && target.contains(to)) return;
    hide();
  });
  document.addEventListener('pointerdown', hide, true);
  document.addEventListener('keydown', hide, true);
  window.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
}

/** Bereiche, die man seitlich (bzw. in Pop-ups und den PC-Spalten nach unten) scrollen kann, zeigen am Rand einen Verlauf, solange es dort weitergeht. */
const HSCROLL_ONLY = '.doc-toolbar, .math-display, .math-preview, .doc-content span.math, .doc-content .cols';
const VSCROLL = '.sheet-body, .sheet-main, .split-pane .list';
const HSCROLL = `${HSCROLL_ONLY}, ${VSCROLL}`;
function scrollHints() {
  const update = (el: HTMLElement) => {
    if (el.matches(VSCROLL)) {
      const maxY = el.scrollHeight - el.clientHeight;
      el.classList.toggle('more-up', maxY > 1 && el.scrollTop > 1);
      el.classList.toggle('more-down', maxY > 1 && el.scrollTop < maxY - 1);
      return;
    }
    const max = el.scrollWidth - el.clientWidth;
    el.classList.toggle('more-left', max > 1 && el.scrollLeft > 1);
    el.classList.toggle('more-right', max > 1 && el.scrollLeft < max - 1);
  };
  const ro = new ResizeObserver((entries) => entries.forEach((en) => update(en.target as HTMLElement)));
  const known = new WeakSet<Element>();
  const scan = () => {
    document.querySelectorAll<HTMLElement>(HSCROLL).forEach((el) => {
      if (!known.has(el)) {
        known.add(el);
        ro.observe(el);
      }
      update(el);
    });
  };
  document.addEventListener(
    'scroll',
    (e) => {
      const el = e.target as HTMLElement;
      if (el instanceof HTMLElement && el.matches(HSCROLL)) update(el);
    },
    true,
  );
  let pending = 0;
  new MutationObserver(() => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      scan();
    });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });
  scan();
}

/** Uhr, die überall in der App zu sehen ist (auch in geöffneten Dateien). Klicks gehen durch sie hindurch. */
function clock() {
  const el = document.createElement('div');
  el.className = 'app-clock';
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  const fmt = new Intl.DateTimeFormat('de-AT', { hour: '2-digit', minute: '2-digit' });
  const tick = () => {
    el.textContent = fmt.format(new Date());
    // Genau zum nächsten Minutenwechsel wieder aktualisieren.
    window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
  };
  tick();
  // Nach dem Aufwachen des Geräts sofort die richtige Zeit zeigen.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) el.textContent = fmt.format(new Date());
  });
}

export function initUiHelpers() {
  clock();
  blockAppZoom();
  quickTooltips();
  scrollHints();
}
