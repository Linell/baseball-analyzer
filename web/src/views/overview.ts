// Batter overview: the dataset-level landing page. One row per qualifying
// batter with the rate-card figures; a click opens that batter's analysis.

import { el } from '../dom';
import type { OverviewBatter, RateInterval, State } from '../state';

type MetricKey = 'chase' | 'whiff' | 'in_zone_swing' | 'hard_hit' | 'bat_speed';
type SortKey = 'name' | 'pitches' | 'swings' | MetricKey;

interface ColumnSpec {
  label: string;
  key: SortKey | null; // null = not sortable
  isFraction: boolean;
  title?: string;
}

const METRIC_COLUMNS: Array<ColumnSpec & { key: MetricKey }> = [
  { label: 'Chase%', key: 'chase', isFraction: true, title: 'Swings at pitches outside the zone' },
  { label: 'Whiff%', key: 'whiff', isFraction: true, title: 'Misses per swing' },
  { label: 'In-zone swing%', key: 'in_zone_swing', isFraction: true },
  { label: 'Hard-hit%', key: 'hard_hit', isFraction: true, title: 'Batted balls ≥ 95 mph' },
  { label: 'Bat speed', key: 'bat_speed', isFraction: false, title: 'mph, bunts excluded' },
];

const COLUMNS: ColumnSpec[] = [
  { label: 'Batter', key: 'name', isFraction: false },
  { label: 'Bats', key: null, isFraction: false, title: 'Batting side; S = switch hitter' },
  { label: 'Pitches', key: 'pitches', isFraction: false },
  { label: 'Swings', key: 'swings', isFraction: false },
  ...METRIC_COLUMNS,
];

// Sort survives redraws (module scope), resets to the API's swings-desc order
// only on reload. Numeric columns start descending: "who chases most" is the
// question a coach is asking.
let sortKey: SortKey = 'swings';
let sortDesc = true;

function sortValue(batter: OverviewBatter, key: SortKey): number | string | null {
  if (key === 'name') return batter.name;
  if (key === 'pitches') return batter.pitches;
  if (key === 'swings') return batter.swings;
  const interval = batter.rates[key];
  return interval ? interval.estimate : null;
}

function formatRate(interval: RateInterval | null, isFraction: boolean): string {
  if (!interval) return '—';
  return isFraction ? `${(interval.estimate * 100).toFixed(1)}%` : interval.estimate.toFixed(1);
}

function batsLabel(sides: string[]): string {
  return sides.length > 1 ? 'S' : sides[0] ?? '';
}

export function renderOverview(
  container: HTMLElement,
  state: State,
  onSelectBatter: (bamId: number) => void,
): void {
  container.innerHTML = '';
  const rerender = (): void => renderOverview(container, state, onSelectBatter);

  container.appendChild(
    el(
      'div',
      { className: 'panel' },
      el('h2', {}, 'Batter overview'),
      el('div', { className: 'pitch-list-count' }, `${state.overview.length} batters · min 100 swings`),
      state.overview.length === 0
        ? el('div', { className: 'disabled-note' }, 'This dataset has no batters clearing the swing threshold.')
        : el(
            'table',
            { className: 'pitch-table overview-table' },
            el('thead', {}, el('tr', {}, ...COLUMNS.map((column) => headerCell(column, rerender)))),
            el('tbody', {}, ...sortedBatters(state).map((batter) => batterRow(batter, onSelectBatter))),
          ),
    ),
  );
}

function headerCell(column: ColumnSpec, rerender: () => void): HTMLTableCellElement {
  const isActive = column.key !== null && column.key === sortKey;
  const th = el(
    'th',
    column.title !== undefined ? { title: column.title } : {},
    column.label + (isActive ? (sortDesc ? ' ▾' : ' ▴') : ''),
  );
  const key = column.key;
  if (key !== null) {
    th.classList.add('sortable');
    th.onclick = (): void => {
      if (sortKey === key) {
        sortDesc = !sortDesc;
      } else {
        sortKey = key;
        sortDesc = key !== 'name';
      }
      rerender();
    };
  }
  return th;
}

function sortedBatters(state: State): OverviewBatter[] {
  return [...state.overview].sort((a, b) => {
    const va = sortValue(a, sortKey);
    const vb = sortValue(b, sortKey);
    if (va === null && vb === null) return 0;
    if (va === null) return 1; // missing values sink regardless of direction
    if (vb === null) return -1;
    const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return sortDesc ? -cmp : cmp;
  });
}

function batterRow(batter: OverviewBatter, onSelectBatter: (bamId: number) => void): HTMLTableRowElement {
  const row = el(
    'tr',
    { onclick: () => onSelectBatter(batter.bam_id) },
    el('td', {}, batter.name),
    el('td', {}, batsLabel(batter.sides)),
    el('td', {}, String(batter.pitches)),
    el('td', {}, String(batter.swings)),
  );
  for (const column of METRIC_COLUMNS) {
    const interval = batter.rates[column.key];
    row.appendChild(
      el('td', interval ? { title: `n = ${interval.n}` } : {}, formatRate(interval, column.isFraction)),
    );
  }
  return row;
}
