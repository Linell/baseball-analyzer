// Every fetch that lands in state, in one place: boot, the dataset and batter
// picks, and the zone map's plate-appearance scope toggle. Each load runs
// under a request token (state.ts) so a stale response cannot land over a
// newer pick, and every failure lands in state.error rather than the console.

import {
  fetchBatters,
  fetchDatasets,
  fetchOverview,
  fetchPitches,
  fetchRates,
  fetchZone,
} from './api';
import { getState, isCurrentRequest, nextRequestToken, replaceState } from './state';

// The one try/catch: run a load under a fresh token, and report its failure
// as `fallback` unless a newer load superseded it while it was in flight.
async function guardedLoad(
  fallback: string,
  load: (token: number) => Promise<void>,
): Promise<void> {
  const token = nextRequestToken();
  try {
    await load(token);
  } catch (err) {
    if (!isCurrentRequest(token)) return;
    replaceState({ error: err instanceof Error ? err.message : fallback, loading: false });
  }
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

export async function boot(): Promise<void> {
  await guardedLoad('Failed to load datasets', async (token) => {
    const datasets = await fetchDatasets();
    if (!isCurrentRequest(token)) return;
    replaceState({ datasets });
    const datasetKey = datasets.find((d) => !d.is_reference)?.key ?? null;
    if (datasetKey === null) {
      replaceState({ loading: false, error: 'No datasets available.' });
      return;
    }
    await onDatasetChange(datasetKey);
  });
}

// A dataset pick invalidates everything downstream of it.
export async function onDatasetChange(datasetKey: string): Promise<void> {
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
  await guardedLoad('Failed to load dataset', async (token) => {
    const batterId = await loadBattersAndOverview(token, datasetKey);
    if (batterId === null) return;
    await loadBatterData(token, datasetKey, batterId, getState().firstTimeThrough);
  });
}

export async function onBatterChange(batterId: number): Promise<void> {
  const { datasetKey, firstTimeThrough } = getState();
  if (!datasetKey) return;
  replaceState({ batterId, selection: null, loading: true });
  await guardedLoad('Failed to load batter', (token) =>
    loadBatterData(token, datasetKey, batterId, firstTimeThrough),
  );
}

// The scope toggle refetches only the zone grid; the rate card and pitch list
// stay full-sample.
export async function onFirstTimeThroughChange(firstTimeThrough: boolean): Promise<void> {
  const { datasetKey, batterId } = getState();
  // Clear the selection: a cell picked under one scope must not keep
  // filtering the pitch list under another.
  replaceState({ firstTimeThrough, selection: null });
  if (!datasetKey || batterId === null) return;
  await guardedLoad('Failed to load zone data', async (token) => {
    const cells = await fetchZone(datasetKey, batterId, firstTimeThrough);
    if (!isCurrentRequest(token)) return;
    replaceState({ zoneCells: cells, error: null });
  });
}
