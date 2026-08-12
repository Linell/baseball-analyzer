// The sticky app header: title, the dataset picker on every screen, the
// batter picker on analysis only, and the route nav.

import { onBatterChange, onDatasetChange } from './actions';
import { el } from './dom';
import { ROUTES, currentRoute, type Route } from './routes';
import type { State } from './state';

export function renderHeader(state: State): HTMLElement {
  const route = currentRoute();
  const header = el(
    'header',
    { className: 'app-header' },
    el('h1', {}, 'Baseball Analyzer'),
    picker(
      'Dataset',
      state.datasets.filter((d) => !d.is_reference).map((d) => ({ value: d.key, label: d.name })),
      state.datasetKey,
      (key) => void onDatasetChange(key),
    ),
    // The batter picker only drives the Analysis screen; showing it on
    // /overview or /showcase would imply it does something there.
    route === '/analysis' &&
      picker(
        'Batter',
        state.batters.map((b) => ({ value: String(b.bam_id), label: b.name })),
        state.batterId === null ? null : String(state.batterId),
        (id) => void onBatterChange(Number(id)),
      ),
    nav(route),
  );
  observeHeight(header);
  return header;
}

function picker(
  caption: string,
  options: Array<{ value: string; label: string }>,
  selected: string | null,
  onChange: (value: string) => void,
): HTMLElement {
  const select = el(
    'select',
    { ariaLabel: caption },
    ...options.map((o) => el('option', { value: o.value, selected: o.value === selected }, o.label)),
  );
  select.onchange = () => onChange(select.value);
  return el('label', { className: 'picker' }, el('span', {}, caption), select);
}

function nav(active: Route): HTMLElement {
  return el(
    'nav',
    {},
    ...ROUTES.map(({ path, label }) =>
      el('a', { href: `#${path}`, className: path === active ? 'active' : '' }, label),
    ),
  );
}

/* The app header is sticky, so anything that sticks to the page rather than to
   a scroll box of its own — the overview's column labels, a row scrolled into
   view — has to know how tall it is. Measured, not assumed: the header grows
   when the nav wraps or when a platform draws taller selects, and a stale
   number would hide those elements behind it rather than below it. */
const headerHeight = new ResizeObserver((entries) => {
  const height = entries[0]?.borderBoxSize[0]?.blockSize;
  if (height === undefined) return;
  document.documentElement.style.setProperty('--header-h', `${Math.ceil(height)}px`);
});

function observeHeight(header: HTMLElement): void {
  // Every render builds a new header, so drop the old subscription first.
  headerHeight.disconnect();
  headerHeight.observe(header);
}
