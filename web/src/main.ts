// Hash routing (#/overview default, #/analysis, #/showcase placeholder) plus
// the header: the dataset picker on every screen, the batter picker on
// analysis only.

import type { State } from './state';
import { getState, isCurrentRequest, nextRequestToken, replaceState, subscribe } from './state';
import {
  fetchDatasets,
  fetchBatters,
  fetchOverview,
  fetchZone,
  fetchRates,
  fetchPitches,
} from './api';
import { renderZoneMap } from './views/zoneMap';
import { renderRateCard } from './views/rateCard';
import { renderPitchList } from './views/pitchList';
import { renderOverview } from './views/overview';

// Lazy: three.js and the flight code stay out of the analysis bundle.
let flightModule: Promise<typeof import('./flight/showcase')> | null = null;

const app = document.getElementById('app');
if (!app) throw new Error('#app not found');

type Route = '/overview' | '/analysis' | '/showcase';

function currentRoute(): Route {
  const hash = window.location.hash.replace(/^#/, '');
  if (hash === '/analysis') return '/analysis';
  if (hash === '/showcase') return '/showcase';
  return '/overview';
}

function renderHeader(state: State): HTMLElement {
  const header = document.createElement('header');
  header.className = 'app-header';

  const title = document.createElement('h1');
  title.textContent = 'Baseball Analyzer';
  header.appendChild(title);

  const datasetSelect = document.createElement('select');
  datasetSelect.setAttribute('aria-label', 'Dataset');
  for (const dataset of state.datasets.filter((d) => !d.is_reference)) {
    const option = document.createElement('option');
    option.value = dataset.key;
    option.textContent = dataset.name;
    option.selected = dataset.key === state.datasetKey;
    datasetSelect.appendChild(option);
  }
  datasetSelect.addEventListener('change', () => onDatasetChange(datasetSelect.value));
  header.appendChild(labeledPicker('Dataset', datasetSelect));

  const route = currentRoute();

  // Batter picker only drives the Analysis screen; showing it on /overview or
  // /showcase would imply it does something there.
  if (route === '/analysis') {
    const batterSelect = document.createElement('select');
    batterSelect.setAttribute('aria-label', 'Batter');
    for (const batter of state.batters) {
      const option = document.createElement('option');
      option.value = String(batter.bam_id);
      option.textContent = batter.name;
      option.selected = batter.bam_id === state.batterId;
      batterSelect.appendChild(option);
    }
    batterSelect.addEventListener('change', () => onBatterChange(Number(batterSelect.value)));
    header.appendChild(labeledPicker('Batter', batterSelect));
  }

  const nav = document.createElement('nav');
  const links: Array<[Route, string]> = [
    ['/overview', 'Overview'],
    ['/analysis', 'Analysis'],
    ['/showcase', 'Showcase'],
  ];
  for (const [path, label] of links) {
    const link = document.createElement('a');
    link.href = `#${path}`;
    link.textContent = label;
    link.className = route === path ? 'active' : '';
    nav.appendChild(link);
  }
  header.appendChild(nav);

  return header;
}

function labeledPicker(caption: string, select: HTMLSelectElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'picker';
  const captionSpan = document.createElement('span');
  captionSpan.textContent = caption;
  wrap.appendChild(captionSpan);
  wrap.appendChild(select);
  return wrap;
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

function render(state: State): void {
  if (!app) return;
  app.innerHTML = '';
  const header = renderHeader(state);
  app.appendChild(header);
  // render() rebuilds the DOM, so the observed element is a new one each time.
  headerHeight.disconnect();
  headerHeight.observe(header);

  const main = document.createElement('main');
  app.appendChild(main);

  // The early return is also what keeps analysis-pipeline errors (e.g. "no
  // qualifying batters") off the showcase, which shares only the dataset
  // picker, API client and theme.
  if (currentRoute() === '/showcase') {
    // The showcase caches its mount internally so state-driven redraws
    // re-attach the live WebGL canvas instead of rebuilding it.
    const dataset = state.datasets.find((d) => d.key === state.datasetKey) ?? null;
    flightModule ??= import('./flight/showcase');
    void flightModule.then((flight) => {
      if (currentRoute() === '/showcase' && main.isConnected) {
        flight.mountShowcase(main, dataset);
      }
    });
    return;
  }

  if (state.error) {
    const banner = document.createElement('div');
    banner.className = 'error-banner';
    banner.textContent = state.error;
    main.appendChild(banner);
  }

  if (state.loading) {
    const loading = document.createElement('div');
    loading.className = 'disabled-note';
    loading.textContent = 'Loading…';
    main.appendChild(loading);
    return;
  }

  if (currentRoute() === '/overview') {
    const overviewContainer = document.createElement('div');
    main.appendChild(overviewContainer);
    renderOverview(overviewContainer, state, (bamId) => {
      window.location.hash = '#/analysis';
      void onBatterChange(bamId);
    });
    return;
  }

  const zoneContainer = document.createElement('div');
  main.appendChild(zoneContainer);
  renderZoneMap(zoneContainer, state);

  const bottomRow = document.createElement('div');
  bottomRow.style.display = 'grid';
  bottomRow.style.gridTemplateColumns = '1fr 1fr';
  bottomRow.style.gap = '20px';
  main.appendChild(bottomRow);

  const rateContainer = document.createElement('div');
  bottomRow.appendChild(rateContainer);
  renderRateCard(rateContainer, state);

  const pitchContainer = document.createElement('div');
  bottomRow.appendChild(pitchContainer);
  renderPitchList(pitchContainer, state);
}

async function loadBatterData(
  token: number,
  datasetKey: string,
  batterId: number,
  firstTimeThrough: boolean,
): Promise<void> {
  const [zoneCells, rates, pitches] = await Promise.all([
    fetchZone(datasetKey, batterId, firstTimeThrough),
    fetchRates(datasetKey, batterId),
    fetchPitches(datasetKey, batterId),
  ]);
  if (!isCurrentRequest(token)) return; // a newer pick already superseded this load
  replaceState({ zoneCells, rates, pitches, selection: null, error: null, loading: false });
}

// Fetches batters + overview for a dataset and picks the first batter.
// Sets the "no qualifying batters" error itself; returns null when there's
// nothing further to load, whether because the request went stale or the
// dataset came up empty.
async function loadBattersAndOverview(token: number, datasetKey: string): Promise<number | null> {
  const [batters, overview] = await Promise.all([
    fetchBatters(datasetKey),
    fetchOverview(datasetKey),
  ]);
  if (!isCurrentRequest(token)) return null;
  const batterId = batters[0]?.bam_id ?? null;
  replaceState({ batters, overview, batterId });
  if (batterId === null) {
    replaceState({
      error: 'This dataset has no batters clearing the swing threshold.',
      loading: false,
    });
  }
  return batterId;
}

async function onDatasetChange(datasetKey: string): Promise<void> {
  const token = nextRequestToken();
  replaceState({
    datasetKey,
    batters: [],
    overview: [],
    batterId: null,
    zoneCells: [],
    rates: null,
    pitches: [],
    selection: null,
    loading: true,
  });
  try {
    const batterId = await loadBattersAndOverview(token, datasetKey);
    if (batterId === null) return;
    await loadBatterData(token, datasetKey, batterId, getState().firstTimeThrough);
  } catch (err) {
    if (!isCurrentRequest(token)) return;
    replaceState({
      error: err instanceof Error ? err.message : 'Failed to load dataset',
      loading: false,
    });
  }
}

async function onBatterChange(batterId: number): Promise<void> {
  const state = getState();
  if (!state.datasetKey) return;
  const token = nextRequestToken();
  replaceState({ batterId, selection: null, loading: true });
  try {
    await loadBatterData(token, state.datasetKey, batterId, state.firstTimeThrough);
  } catch (err) {
    if (!isCurrentRequest(token)) return;
    replaceState({
      error: err instanceof Error ? err.message : 'Failed to load batter',
      loading: false,
    });
  }
}

async function boot(): Promise<void> {
  const token = nextRequestToken();
  try {
    const datasets = await fetchDatasets();
    if (!isCurrentRequest(token)) return;
    const nonReference = datasets.filter((d) => !d.is_reference);
    const datasetKey = nonReference[0]?.key ?? null;
    replaceState({ datasets, datasetKey });
    if (!datasetKey) {
      replaceState({ loading: false, error: 'No datasets available.' });
      return;
    }
    const batterId = await loadBattersAndOverview(token, datasetKey);
    if (batterId === null) return;
    await loadBatterData(token, datasetKey, batterId, false);
  } catch (err) {
    if (!isCurrentRequest(token)) return;
    replaceState({
      error: err instanceof Error ? err.message : 'Failed to load application data',
      loading: false,
    });
  }
}

subscribe(render);
window.addEventListener('hashchange', () => render(getState()));
render(getState());
void boot();
