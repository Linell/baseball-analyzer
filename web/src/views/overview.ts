// Batter overview: the dataset-level landing page. One row per qualifying
// batter with the rate-card figures; a click opens that batter's analysis.

import type { OverviewBatter, RateInterval, State } from '../state';

type MetricKey = 'chase' | 'whiff' | 'in_zone_swing' | 'hard_hit' | 'bat_speed';
type SortKey = 'name' | 'pitches' | 'swings' | MetricKey;

interface ColumnSpec {
  label: string;
  key: SortKey | null; // null = not sortable
  isFraction: boolean;
  title?: string;
}

const METRIC_COLUMNS: ColumnSpec[] = [
  { label: 'Chase%', key: 'chase', isFraction: true, title: 'Swings at pitches outside the zone' },
  { label: 'Whiff%', key: 'whiff', isFraction: true, title: 'Misses per swing' },
  { label: 'In-zone swing%', key: 'in_zone_swing', isFraction: true },
  { label: 'Hard-hit%', key: 'hard_hit', isFraction: true, title: 'Batted balls ≥ 95 mph' },
  { label: 'Bat speed', key: 'bat_speed', isFraction: false, title: 'mph, bunts excluded' },
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
  const panel = document.createElement('div');
  panel.className = 'panel';
  container.appendChild(panel);

  const heading = document.createElement('h2');
  heading.textContent = 'Batter overview';
  panel.appendChild(heading);

  const count = document.createElement('div');
  count.className = 'pitch-list-count';
  count.textContent = `${state.overview.length} batters · min 100 swings`;
  panel.appendChild(count);

  if (state.overview.length === 0) {
    const note = document.createElement('div');
    note.className = 'disabled-note';
    note.textContent = 'This dataset has no batters clearing the swing threshold.';
    panel.appendChild(note);
    return;
  }

  const table = document.createElement('table');
  table.className = 'pitch-table overview-table';
  panel.appendChild(table);

  const columns: ColumnSpec[] = [
    { label: 'Batter', key: 'name', isFraction: false },
    { label: 'Bats', key: null, isFraction: false, title: 'Batting side; S = switch hitter' },
    { label: 'Pitches', key: 'pitches', isFraction: false },
    { label: 'Swings', key: 'swings', isFraction: false },
    ...METRIC_COLUMNS,
  ];

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const column of columns) {
    const th = document.createElement('th');
    const isActive = column.key !== null && column.key === sortKey;
    th.textContent = column.label + (isActive ? (sortDesc ? ' ▾' : ' ▴') : '');
    if (column.title) th.title = column.title;
    if (column.key !== null) {
      const key = column.key;
      th.classList.add('sortable');
      th.addEventListener('click', () => {
        if (sortKey === key) {
          sortDesc = !sortDesc;
        } else {
          sortKey = key;
          sortDesc = key !== 'name';
        }
        renderOverview(container, state, onSelectBatter);
      });
    }
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const rows = [...state.overview].sort((a, b) => {
    const va = sortValue(a, sortKey);
    const vb = sortValue(b, sortKey);
    if (va === null && vb === null) return 0;
    if (va === null) return 1; // missing values sink regardless of direction
    if (vb === null) return -1;
    const cmp = typeof va === 'string' ? va.localeCompare(vb as string) : (va as number) - (vb as number);
    return sortDesc ? -cmp : cmp;
  });

  const tbody = document.createElement('tbody');
  for (const batter of rows) {
    const row = document.createElement('tr');
    row.appendChild(cell(batter.name));
    row.appendChild(cell(batsLabel(batter.sides)));
    row.appendChild(cell(String(batter.pitches)));
    row.appendChild(cell(String(batter.swings)));
    for (const column of METRIC_COLUMNS) {
      const interval = batter.rates[column.key as MetricKey];
      const td = cell(formatRate(interval, column.isFraction));
      if (interval) td.title = `n = ${interval.n}`;
      row.appendChild(td);
    }
    row.addEventListener('click', () => onSelectBatter(batter.bam_id));
    tbody.appendChild(row);
  }
  table.appendChild(tbody);
}

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}
