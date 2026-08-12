// Rate card: five headline rates, each with its Wilson interval as a small
// bar, a denominator, and (when a baseline row exists) the league median and
// decile/quartile band drawn on the same bar.
//
// Deliberately not filtered by the zone-map/pitch-list selection: re-slicing
// these figures to one cell's handful of pitches would shred the intervals
// the card exists to show (docs/DESIGN.md).

import { select } from 'd3';
import { el } from '../dom';
import type { BaselineRow, Dataset, RateInterval, RatesResponse, State } from '../state';

const BAR_WIDTH = 220;
const BAR_HEIGHT = 34;
// The interval bar sits on this line; ticks and their labels hang below it.
const BAR_MID_Y = 11;

interface RowSpec {
  label: string;
  metricKey: 'chase' | 'whiff' | 'in_zone_swing' | 'hard_hit' | 'bat_speed';
  isFraction: boolean;
}

const ROWS: RowSpec[] = [
  { label: 'Chase%', metricKey: 'chase', isFraction: true },
  { label: 'Whiff%', metricKey: 'whiff', isFraction: true },
  { label: 'In-zone swing%', metricKey: 'in_zone_swing', isFraction: true },
  { label: 'Hard-hit%', metricKey: 'hard_hit', isFraction: true },
  { label: 'Bat speed (mph)', metricKey: 'bat_speed', isFraction: false },
];

function columnNonNull(datasets: Dataset[], datasetKey: string | null, columnName: string): number {
  const dataset = datasets.find((d) => d.key === datasetKey);
  const column = dataset?.columns.find((c) => c.column_name === columnName);
  return column?.non_null_count ?? 0;
}

function formatValue(value: number, isFraction: boolean): string {
  return isFraction ? `${(value * 100).toFixed(1)}%` : `${value.toFixed(1)}`;
}

function formatInterval(interval: RateInterval, isFraction: boolean): string {
  const lo = isFraction ? (interval.lo * 100).toFixed(1) : interval.lo.toFixed(1);
  const hi = isFraction ? (interval.hi * 100).toFixed(1) : interval.hi.toFixed(1);
  return `${lo}–${hi}`;
}

function domainFor(interval: RateInterval, baseline: BaselineRow | undefined, isFraction: boolean): [number, number] {
  if (isFraction) return [0, 1];
  const values = [interval.lo, interval.hi];
  if (baseline) values.push(baseline.p10, baseline.p90);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = Math.max(2, (max - min) * 0.2);
  return [Math.floor(min - padding), Math.ceil(max + padding)];
}

function drawBar(interval: RateInterval, baseline: BaselineRow | undefined, isFraction: boolean): SVGSVGElement {
  const [domainLo, domainHi] = domainFor(interval, baseline, isFraction);
  const scale = (value: number): number => {
    const clamped = Math.min(domainHi, Math.max(domainLo, value));
    return ((clamped - domainLo) / (domainHi - domainLo || 1)) * BAR_WIDTH;
  };

  const svg = select(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
    .attr('width', BAR_WIDTH)
    .attr('height', BAR_HEIGHT)
    .attr('viewBox', `0 0 ${BAR_WIDTH} ${BAR_HEIGHT}`);

  const midY = BAR_MID_Y;

  svg
    .append('line')
    .attr('x1', 0)
    .attr('x2', BAR_WIDTH)
    .attr('y1', midY)
    .attr('y2', midY)
    .attr('stroke', 'var(--gridline)')
    .attr('stroke-width', 1);

  // Scale ticks so the bar reads as an axis, not a decoration.
  const tickValues = isFraction ? [0, 0.5, 1] : [domainLo, (domainLo + domainHi) / 2, domainHi];
  for (const value of tickValues) {
    const x = scale(value);
    svg
      .append('line')
      .attr('x1', x)
      .attr('x2', x)
      .attr('y1', midY + 8)
      .attr('y2', midY + 12)
      .attr('stroke', 'var(--baseline-axis)')
      .attr('stroke-width', 1);
    svg
      .append('text')
      .attr('class', 'rate-tick-label')
      .attr('x', x)
      .attr('y', midY + 21)
      .attr('text-anchor', x === 0 ? 'start' : x === BAR_WIDTH ? 'end' : 'middle')
      .text(isFraction ? `${Math.round(value * 100)}%` : `${Math.round(value)}`);
  }

  if (baseline) {
    svg
      .append('rect')
      .attr('x', scale(baseline.p10))
      .attr('width', Math.max(0, scale(baseline.p90) - scale(baseline.p10)))
      .attr('y', midY - 3)
      .attr('height', 6)
      .attr('fill', 'var(--seq-100)');
    svg
      .append('rect')
      .attr('x', scale(baseline.p25))
      .attr('width', Math.max(0, scale(baseline.p75) - scale(baseline.p25)))
      .attr('y', midY - 4)
      .attr('height', 8)
      .attr('fill', 'var(--seq-200)');
    svg
      .append('line')
      .attr('x1', scale(baseline.p50))
      .attr('x2', scale(baseline.p50))
      .attr('y1', midY - 7)
      .attr('y2', midY + 7)
      .attr('stroke', 'var(--text-secondary)')
      .attr('stroke-width', 2);
  }

  svg
    .append('line')
    .attr('x1', scale(interval.lo))
    .attr('x2', scale(interval.hi))
    .attr('y1', midY)
    .attr('y2', midY)
    .attr('stroke', 'var(--estimate)')
    .attr('stroke-width', 3)
    .attr('stroke-linecap', 'round');

  svg
    .append('circle')
    .attr('cx', scale(interval.estimate))
    .attr('cy', midY)
    .attr('r', 5)
    .attr('fill', 'var(--estimate)')
    .attr('stroke', 'var(--surface-1)')
    .attr('stroke-width', 2);

  return svg.node() as SVGSVGElement;
}

export function renderRateCard(container: HTMLElement, state: State): void {
  container.innerHTML = '';
  const panel = el('div', { className: 'panel' }, el('h2', {}, 'Rate card'));
  container.appendChild(panel);

  const rates = state.rates;
  if (!rates) {
    panel.appendChild(el('div', { className: 'disabled-note' }, 'No rate data loaded.'));
    return;
  }

  const batSpeedTracked = columnNonNull(state.datasets, state.datasetKey, 'bat_speed') > 0;
  for (const row of ROWS) {
    panel.appendChild(rateRow(row, rates, batSpeedTracked));
  }

  const hasBaseline = ROWS.some((row) => rates.baselines[row.metricKey]);
  panel.appendChild(drawLegend(hasBaseline));

  const reference = rates.reference;
  panel.appendChild(
    el(
      'div',
      { className: 'rate-footer' },
      reference
        ? `League reference: ${reference.name}, ${reference.start_date} to ${reference.end_date}`
        : 'No league reference loaded.',
    ),
  );
}

function rateRow(row: RowSpec, rates: RatesResponse, batSpeedTracked: boolean): HTMLElement {
  const label = el('div', { className: 'rate-label' }, row.label);

  // Spans the value/bar/n columns; the grid placement is .rate-row's CSS.
  if (row.metricKey === 'bat_speed' && !batSpeedTracked) {
    return el(
      'div',
      { className: 'rate-row' },
      label,
      el('div', { className: 'rate-not-tracked' }, 'not tracked'),
    );
  }

  const interval = rates.rates[row.metricKey];
  const baseline = rates.baselines[row.metricKey];
  return el(
    'div',
    { className: 'rate-row' },
    label,
    el(
      'div',
      { className: 'rate-value' },
      interval ? formatValue(interval.estimate, row.isFraction) : '—',
      interval !== null &&
        el('div', { className: 'rate-interval' }, formatInterval(interval, row.isFraction)),
    ),
    el(
      'div',
      {},
      interval
        ? drawBar(interval, baseline, row.isFraction)
        : el('span', { className: 'rate-not-tracked' }, 'no qualifying pitches'),
    ),
    el('div', { className: 'rate-n' }, interval ? `n = ${interval.n}` : ''),
  );
}

// Names the marks: what the dot, the bar, and (when present) the band mean.
function drawLegend(hasBaseline: boolean): HTMLElement {
  return el(
    'div',
    { className: 'rate-legend' },
    el('span', { className: 'legend-item' }, batterMark(), 'batter · 95% range'),
    hasBaseline &&
      el('span', { className: 'legend-item' }, leagueBand(), 'league 10–90% · 25–75% · median'),
  );
}

function batterMark(): SVGSVGElement {
  const svg = select(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
    .attr('width', 36)
    .attr('height', 14)
    .attr('viewBox', '0 0 36 14');
  svg
    .append('line')
    .attr('x1', 3)
    .attr('x2', 33)
    .attr('y1', 7)
    .attr('y2', 7)
    .attr('stroke', 'var(--estimate)')
    .attr('stroke-width', 3)
    .attr('stroke-linecap', 'round');
  svg
    .append('circle')
    .attr('cx', 18)
    .attr('cy', 7)
    .attr('r', 4.5)
    .attr('fill', 'var(--estimate)')
    .attr('stroke', 'var(--surface-1)')
    .attr('stroke-width', 2);
  return svg.node() as SVGSVGElement;
}

function leagueBand(): SVGSVGElement {
  const svg = select(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
    .attr('width', 36)
    .attr('height', 14)
    .attr('viewBox', '0 0 36 14');
  svg
    .append('rect')
    .attr('x', 2)
    .attr('width', 32)
    .attr('y', 4)
    .attr('height', 6)
    .attr('fill', 'var(--seq-100)');
  svg
    .append('rect')
    .attr('x', 10)
    .attr('width', 16)
    .attr('y', 3)
    .attr('height', 8)
    .attr('fill', 'var(--seq-200)');
  svg
    .append('line')
    .attr('x1', 18)
    .attr('x2', 18)
    .attr('y1', 0)
    .attr('y2', 14)
    .attr('stroke', 'var(--text-secondary)')
    .attr('stroke-width', 2);
  return svg.node() as SVGSVGElement;
}
