// Wiring: render on every state change and hash change, dispatch the current
// route to a screen, and kick off the boot load. Data loading lives in
// actions.ts, the header in header.ts.

import { boot, onBatterChange } from './actions';
import { el } from './dom';
import { renderHeader } from './header';
import { currentRoute } from './routes';
import type { State } from './state';
import { getState, subscribe } from './state';
import { renderOverview } from './views/overview';
import { renderPitchList } from './views/pitchList';
import { renderRateCard } from './views/rateCard';
import { renderZoneMap } from './views/zoneMap';

// Lazy: three.js and the flight code stay out of the analysis bundle.
let flightModule: Promise<typeof import('./flight/showcase')> | null = null;

function appRoot(): HTMLElement {
  const root = document.getElementById('app');
  if (!root) throw new Error('#app not found');
  return root;
}

const app = appRoot();

function render(state: State): void {
  const route = currentRoute();
  const main = el('main');
  app.replaceChildren(renderHeader(state), main);

  // Showcase first, ahead of the error/loading gates: it draws no analysis
  // data, so a pipeline error (e.g. "no qualifying batters") must not blank a
  // screen that shares only the dataset picker, API client and theme.
  if (route === '/showcase') {
    mountShowcase(main, state);
    return;
  }

  if (state.error) {
    main.appendChild(el('div', { className: 'error-banner' }, state.error));
  }

  if (state.loading) {
    main.appendChild(el('div', { className: 'disabled-note' }, 'Loading…'));
    return;
  }

  if (route === '/overview') renderOverviewScreen(main, state);
  else renderAnalysisScreen(main, state);
}

function renderOverviewScreen(main: HTMLElement, state: State): void {
  const container = el('div');
  main.appendChild(container);
  renderOverview(container, state, (bamId) => {
    window.location.hash = '#/analysis';
    void onBatterChange(bamId);
  });
}

function renderAnalysisScreen(main: HTMLElement, state: State): void {
  const zone = el('div');
  const rates = el('div');
  const pitches = el('div');
  main.append(zone, el('div', { className: 'analysis-bottom-row' }, rates, pitches));
  renderZoneMap(zone, state);
  renderRateCard(rates, state);
  renderPitchList(pitches, state);
}

function mountShowcase(main: HTMLElement, state: State): void {
  // The showcase caches its mount internally so state-driven redraws
  // re-attach the live WebGL canvas instead of rebuilding it.
  const dataset = state.datasets.find((d) => d.key === state.datasetKey) ?? null;
  flightModule ??= import('./flight/showcase');
  void flightModule.then((flight) => {
    if (currentRoute() === '/showcase' && main.isConnected) {
      flight.mountShowcase(main, dataset);
    }
  });
}

subscribe(render);
window.addEventListener('hashchange', () => render(getState()));
render(getState());
void boot();
