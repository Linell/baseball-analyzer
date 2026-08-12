// Zone decision map: three schematic plate diagrams, one per strike bucket,
// plus an annotated key and a color legend so the encoding explains itself.
// Reading across the three is the product (docs/DESIGN.md, Frontend).

import { select, interpolateRgbBasis, type Selection } from 'd3';
import type { Dataset, Pitch, State, ZoneCell } from '../state';
import { getState, isCurrentRequest, nextRequestToken, replaceState } from '../state';
import { fetchZone } from '../api';
import { pitchTypeName } from '../pitchTypes';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const DIAGRAM_W = 160;
const DIAGRAM_H = 204;
const MARGIN = 12;
// Space under the plate area for the away/in axis labels.
const BOTTOM_AXIS = 26;
// Left gutter on the key diagram only, for the up/down axis.
const KEY_GUTTER = 24;
// Mirrors ZONE_HALF_WIDTH in src/baseball_analyzer/definitions.py.
const ZONE_HALF_WIDTH_FT = 0.83;
// Below this many pitches a cell's fill fades: the color is mostly noise.
const LOW_N_PITCHES = 10;
const LOW_N_OPACITY = 0.45;
const STRIKE_BUCKETS: Array<[number, string]> = [
  [0, '0 strikes'],
  [1, '1 strike'],
  [2, '2 strikes'],
];
const QUADRANTS: Array<[string, 'tl' | 'tr' | 'bl' | 'br']> = [
  ['up_away', 'tl'],
  ['up_in', 'tr'],
  ['down_away', 'bl'],
  ['down_in', 'br'],
];

const swingColor = interpolateRgbBasis([
  '#cde2fb',
  '#9ec5f4',
  '#6da7ec',
  '#3987e5',
  '#256abf',
  '#184f95',
  '#0d366b',
]);

function geometry(): { outer: Rect; band: Rect; heart: Rect } {
  const outer = {
    x: MARGIN,
    y: MARGIN,
    w: DIAGRAM_W - 2 * MARGIN,
    h: DIAGRAM_H - MARGIN - BOTTOM_AXIS,
  };
  const bandW = outer.w * 0.66;
  const bandH = outer.h * 0.66;
  const band = {
    x: outer.x + (outer.w - bandW) / 2,
    y: outer.y + (outer.h - bandH) / 2,
    w: bandW,
    h: bandH,
  };
  // The band spans exactly twice the zone in each direction, so the heart is
  // exactly half the band; anything else distorts the pitch marker's mapping.
  const heartW = band.w * 0.5;
  const heartH = band.h * 0.5;
  const heart = {
    x: band.x + (band.w - heartW) / 2,
    y: band.y + (band.h - heartH) / 2,
    w: heartW,
    h: heartH,
  };
  return { outer, band, heart };
}

function quadrantRect(band: Rect, corner: 'tl' | 'tr' | 'bl' | 'br'): Rect {
  const cx = band.x + band.w / 2;
  const cy = band.y + band.h / 2;
  const x = corner === 'tr' || corner === 'br' ? cx : band.x;
  const y = corner === 'bl' || corner === 'br' ? cy : band.y;
  return { x, y, w: band.w / 2, h: band.h / 2 };
}

function columnNonNull(datasets: Dataset[], datasetKey: string | null, columnName: string): number {
  const dataset = datasets.find((d) => d.key === datasetKey);
  const column = dataset?.columns.find((c) => c.column_name === columnName);
  return column?.non_null_count ?? 0;
}

function hasPlateLocationData(state: State): boolean {
  return (
    columnNonNull(state.datasets, state.datasetKey, 'plate_x') > 0 &&
    columnNonNull(state.datasets, state.datasetKey, 'plate_z') > 0 &&
    columnNonNull(state.datasets, state.datasetKey, 'strikezone_top') > 0 &&
    columnNonNull(state.datasets, state.datasetKey, 'strikezone_bot') > 0
  );
}

function hasBatSpeedData(state: State): boolean {
  return columnNonNull(state.datasets, state.datasetKey, 'bat_speed') > 0;
}

// Integer percent inside the small cells; one decimal in the detail tiles.
function pctText(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function pctDetail(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function pitchMarkerPosition(
  pitch: Pitch,
  geo: { outer: Rect; band: Rect },
): { x: number; y: number } | null {
  const xFeet = pitch.batter_relative_x_ft;
  if (xFeet === null || pitch.plate_z === null || pitch.sz_top === null || pitch.sz_bot === null) {
    return null;
  }
  // Linear in feet across the band: the band edge is 2x the zone half-width
  // horizontally and one zone height above/below the zone center vertically,
  // so a pitch's drawn cell always agrees with its API-assigned region.
  const zoneHeight = pitch.sz_top - pitch.sz_bot;
  if (zoneHeight <= 0) return null;
  const zoneCenter = (pitch.sz_top + pitch.sz_bot) / 2;
  const xFraction = xFeet / (2 * ZONE_HALF_WIDTH_FT);
  const zFraction = (pitch.plate_z - zoneCenter) / zoneHeight;
  const x = geo.band.x + geo.band.w / 2 + xFraction * (geo.band.w / 2);
  const y = geo.band.y + geo.band.h / 2 - zFraction * (geo.band.h / 2);
  const clampedX = Math.min(geo.outer.x + geo.outer.w - 2, Math.max(geo.outer.x + 2, x));
  const clampedY = Math.min(geo.outer.y + geo.outer.h - 2, Math.max(geo.outer.y + 2, y));
  return { x: clampedX, y: clampedY };
}

function selectedPitchOf(state: State): Pitch | null {
  if (state.selection?.kind !== 'pitch') return null;
  const pitchId = state.selection.pitchId;
  return state.pitches.find((p) => p.id === pitchId) ?? null;
}

export function renderZoneMap(container: HTMLElement, state: State): void {
  container.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'panel';
  container.appendChild(panel);

  // The scope toggle lives in the panel's title bar: being part of this
  // heading is what says "these diagrams only", so no parenthetical needed.
  const headingRow = document.createElement('div');
  headingRow.className = 'panel-heading-row';
  panel.appendChild(headingRow);

  const heading = document.createElement('h2');
  heading.textContent = 'Zone decision map';
  headingRow.appendChild(heading);

  const toggle = document.createElement('div');
  toggle.className = 'seg-toggle';
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', 'Plate appearance scope');
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.textContent = 'All PAs';
  allBtn.className = state.firstTimeThrough ? '' : 'active';
  allBtn.addEventListener('click', () => {
    if (getState().firstTimeThrough) onFirstTimeThroughChange(false);
  });
  const ttoBtn = document.createElement('button');
  ttoBtn.type = 'button';
  ttoBtn.textContent = '1st time thru order';
  ttoBtn.title = "Only pitches from this batter's first time facing each pitcher in a game.";
  ttoBtn.className = state.firstTimeThrough ? 'active' : '';
  ttoBtn.addEventListener('click', () => {
    if (!getState().firstTimeThrough) onFirstTimeThroughChange(true);
  });
  toggle.appendChild(allBtn);
  toggle.appendChild(ttoBtn);
  headingRow.appendChild(toggle);

  const batter = state.batters.find((b) => b.bam_id === state.batterId);
  if (batter && batter.sides.length > 1) {
    const note = document.createElement('div');
    note.className = 'zone-note';
    note.textContent = 'Switch hitter: both sides pooled, batter-relative.';
    panel.appendChild(note);
  }

  if (!hasPlateLocationData(state)) {
    const note = document.createElement('div');
    note.className = 'disabled-note';
    note.textContent = 'This dataset does not carry plate-location columns.';
    panel.appendChild(note);
    return;
  }

  const cellByKey = new Map<string, ZoneCell>();
  for (const cell of state.zoneCells) {
    cellByKey.set(`${cell.region}_${cell.strike_bucket}`, cell);
  }

  const content = document.createElement('div');
  content.className = 'zone-content';
  panel.appendChild(content);

  content.appendChild(renderKeyDiagram());

  const mainCol = document.createElement('div');
  mainCol.className = 'zone-main';
  content.appendChild(mainCol);

  const diagramsDiv = document.createElement('div');
  diagramsDiv.className = 'zone-diagrams';
  mainCol.appendChild(diagramsDiv);

  const selectedPitch = selectedPitchOf(state);

  for (const [strikeBucket, title] of STRIKE_BUCKETS) {
    diagramsDiv.appendChild(renderDiagram(strikeBucket, title, cellByKey, state, selectedPitch));
  }

  mainCol.appendChild(renderColorLegend());

  panel.appendChild(renderDetail(state, cellByKey, selectedPitch));
}

// The annotated schematic: names the three region kinds and orients the axes,
// so the data diagrams need no explanatory text.
function renderKeyDiagram(): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'zone-diagram zone-key';
  figure.style.margin = '0';

  const svg = select(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
    .attr('width', DIAGRAM_W + KEY_GUTTER)
    .attr('height', DIAGRAM_H)
    .attr('viewBox', `0 0 ${DIAGRAM_W + KEY_GUTTER} ${DIAGRAM_H}`);
  figure.appendChild(svg.node() as SVGSVGElement);

  const geo = geometry();
  const g = svg.append('g').attr('transform', `translate(${KEY_GUTTER},0)`);

  g.append('rect')
    .attr('x', geo.outer.x)
    .attr('y', geo.outer.y)
    .attr('width', geo.outer.w)
    .attr('height', geo.outer.h)
    .attr('fill', 'none')
    .attr('class', 'zone-key-outline');
  g.append('rect')
    .attr('x', geo.band.x)
    .attr('y', geo.band.y)
    .attr('width', geo.band.w)
    .attr('height', geo.band.h)
    .attr('fill', 'none')
    .attr('class', 'zone-key-outline');
  // Quadrant split, drawn under the heart so the cross never crosses the zone.
  const bandCx = geo.band.x + geo.band.w / 2;
  const bandCy = geo.band.y + geo.band.h / 2;
  g.append('line')
    .attr('x1', bandCx)
    .attr('x2', bandCx)
    .attr('y1', geo.band.y)
    .attr('y2', geo.band.y + geo.band.h)
    .attr('class', 'zone-key-outline');
  g.append('line')
    .attr('x1', geo.band.x)
    .attr('x2', geo.band.x + geo.band.w)
    .attr('y1', bandCy)
    .attr('y2', bandCy)
    .attr('class', 'zone-key-outline');
  g.append('rect')
    .attr('x', geo.heart.x)
    .attr('y', geo.heart.y)
    .attr('width', geo.heart.w)
    .attr('height', geo.heart.h)
    .attr('fill', 'var(--surface-1)')
    .attr('class', 'zone-key-zone');

  const cx = geo.outer.x + geo.outer.w / 2;
  g.append('text')
    .attr('class', 'zone-key-label')
    .attr('x', cx)
    .attr('y', (geo.outer.y + geo.band.y) / 2 + 3)
    .text('waste');
  // docs/DESIGN.md, Definitions: this band is the merged shadow+chase ring, ~3x wider than
  // Savant's chase zone — "chase" alone would read as a false Savant match.
  g.append('text')
    .attr('class', 'zone-key-label')
    .attr('x', cx)
    .attr('y', (geo.band.y + geo.heart.y) / 2 + 3)
    .text('shadow/chase');
  const heartText = g
    .append('text')
    .attr('class', 'zone-key-label')
    .attr('x', cx)
    .attr('y', geo.heart.y + geo.heart.h / 2 - 2);
  heartText.append('tspan').attr('x', cx).attr('dy', 0).text('heart');
  heartText.append('tspan').attr('x', cx).attr('dy', 11).text('(zone)');

  // Vertical axis in the gutter: up/down, batter-relative height.
  const axisX = 18;
  const topY = geo.outer.y + 8;
  const botY = geo.outer.y + geo.outer.h - 8;
  svg
    .append('line')
    .attr('class', 'zone-key-axis')
    .attr('x1', axisX)
    .attr('x2', axisX)
    .attr('y1', topY + 6)
    .attr('y2', botY - 6);
  svg
    .append('polygon')
    .attr('class', 'zone-key-arrow')
    .attr('points', `${axisX - 3.5},${topY + 7} ${axisX + 3.5},${topY + 7} ${axisX},${topY}`);
  svg
    .append('polygon')
    .attr('class', 'zone-key-arrow')
    .attr('points', `${axisX - 3.5},${botY - 7} ${axisX + 3.5},${botY - 7} ${axisX},${botY}`);
  svg
    .append('text')
    .attr('class', 'zone-axis-label')
    .attr('transform', `rotate(-90 ${axisX - 8} ${topY + 22})`)
    .attr('x', axisX - 8)
    .attr('y', topY + 22)
    .text('up');
  svg
    .append('text')
    .attr('class', 'zone-axis-label')
    .attr('transform', `rotate(-90 ${axisX - 8} ${botY - 22})`)
    .attr('x', axisX - 8)
    .attr('y', botY - 22)
    .text('down');

  // Horizontal axis under the plate area: away/in, batter-relative.
  const labelY = geo.outer.y + geo.outer.h + 14;
  const lineY = labelY - 3.5;
  const lineX1 = geo.outer.x + 44;
  const lineX2 = geo.outer.x + geo.outer.w - 30;
  g.append('text')
    .attr('class', 'zone-axis-label')
    .attr('x', geo.outer.x + 12)
    .attr('y', labelY)
    .attr('text-anchor', 'start')
    .text('away');
  g.append('text')
    .attr('class', 'zone-axis-label')
    .attr('x', geo.outer.x + geo.outer.w - 12)
    .attr('y', labelY)
    .attr('text-anchor', 'end')
    .text('in');
  g.append('line')
    .attr('class', 'zone-key-axis')
    .attr('x1', lineX1 + 6)
    .attr('x2', lineX2 - 6)
    .attr('y1', lineY)
    .attr('y2', lineY);
  g.append('polygon')
    .attr('class', 'zone-key-arrow')
    .attr('points', `${lineX1 + 7},${lineY - 3.5} ${lineX1 + 7},${lineY + 3.5} ${lineX1},${lineY}`);
  g.append('polygon')
    .attr('class', 'zone-key-arrow')
    .attr('points', `${lineX2 - 7},${lineY - 3.5} ${lineX2 - 7},${lineY + 3.5} ${lineX2},${lineY}`);

  const caption = document.createElement('figcaption');
  caption.className = 'zone-key-caption';
  caption.textContent = 'key';
  figure.appendChild(caption);
  return figure;
}

// Gradient scale for the cell fill, plus the two special fills.
function renderColorLegend(): HTMLElement {
  const legend = document.createElement('div');
  legend.className = 'zone-color-legend';

  const scaleItem = document.createElement('span');
  scaleItem.className = 'legend-item';
  const scaleLabel = document.createElement('span');
  scaleLabel.className = 'legend-metric';
  scaleLabel.textContent = 'swing%';
  scaleItem.appendChild(scaleLabel);
  scaleItem.appendChild(textSpan('0%'));

  const gradW = 110;
  const gradH = 10;
  const svg = select(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
    .attr('width', gradW)
    .attr('height', gradH)
    .attr('viewBox', `0 0 ${gradW} ${gradH}`);
  const grad = svg
    .append('defs')
    .append('linearGradient')
    .attr('id', 'swing-pct-gradient')
    .attr('x1', '0')
    .attr('x2', '1')
    .attr('y1', '0')
    .attr('y2', '0');
  for (let i = 0; i <= 4; i++) {
    grad
      .append('stop')
      .attr('offset', `${i * 25}%`)
      .attr('stop-color', swingColor(i / 4));
  }
  svg
    .append('rect')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', gradW)
    .attr('height', gradH)
    .attr('rx', 2)
    .attr('fill', 'url(#swing-pct-gradient)');
  scaleItem.appendChild(svg.node() as SVGSVGElement);
  scaleItem.appendChild(textSpan('100%'));
  legend.appendChild(scaleItem);

  legend.appendChild(swatchItem(swingColor(0.5), LOW_N_OPACITY, `n < ${LOW_N_PITCHES}`));
  legend.appendChild(swatchItem('hatch', 1, 'no pitches'));
  return legend;
}

function appendHatchPattern(
  svg: Selection<SVGSVGElement, unknown, null, undefined>,
  id: string,
): void {
  const pattern = svg
    .append('defs')
    .append('pattern')
    .attr('id', id)
    .attr('width', 6)
    .attr('height', 6)
    .attr('patternUnits', 'userSpaceOnUse')
    .attr('patternTransform', 'rotate(45)');
  pattern.append('rect').attr('width', 6).attr('height', 6).attr('fill', 'var(--surface-1)');
  pattern
    .append('line')
    .attr('x1', 0)
    .attr('y1', 0)
    .attr('x2', 0)
    .attr('y2', 6)
    .attr('stroke', 'var(--gridline)')
    .attr('stroke-width', 2);
}

function textSpan(text: string): HTMLElement {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

function swatchItem(fill: string, opacity: number, label: string): HTMLElement {
  const item = document.createElement('span');
  item.className = 'legend-item';
  const svg = select(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
    .attr('width', 14)
    .attr('height', 12)
    .attr('viewBox', '0 0 14 12');
  if (fill === 'hatch') {
    appendHatchPattern(svg, 'zone-hatch-legend');
    fill = 'url(#zone-hatch-legend)';
  }
  svg
    .append('rect')
    .attr('x', 0)
    .attr('y', 1)
    .attr('width', 14)
    .attr('height', 10)
    .attr('rx', 2)
    .attr('fill', fill)
    .attr('fill-opacity', opacity);
  item.appendChild(svg.node() as SVGSVGElement);
  item.appendChild(textSpan(label));
  return item;
}

// A cell aggregate and a single pitch share units (%, mph) and layout, so the
// two must not share a presentation: reading one as the other is the whole
// hazard. Each selection kind gets its own titled mode, and "nothing selected"
// gets a prompt rather than dashes — a dash means "no data" everywhere else.
function renderDetail(
  state: State,
  cellByKey: Map<string, ZoneCell>,
  selectedPitch: Pitch | null,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'zone-detail';

  if (selectedPitch) {
    wrap.appendChild(detailTitle('This pitch', pitchLocationLabel(selectedPitch)));
    wrap.appendChild(pitchTiles(selectedPitch, state));
    return wrap;
  }

  if (state.selection?.kind === 'cell') {
    const { region, strikeBucket } = state.selection;
    wrap.appendChild(detailTitle('Zone average', cellLabel(region, strikeBucket)));
    wrap.appendChild(cellTiles(cellByKey.get(`${region}_${strikeBucket}`), state));
    return wrap;
  }

  wrap.appendChild(emptyPrompt());
  return wrap;
}

// The mode name leads and is emphasized: it is the one word that says whether
// these numbers describe many pitches or one.
function detailTitle(mode: string, scope: string | null): HTMLElement {
  const title = document.createElement('div');
  title.className = 'zone-detail-title';
  const strong = document.createElement('span');
  strong.className = 'zone-detail-mode';
  strong.textContent = mode;
  title.appendChild(strong);
  if (scope) title.appendChild(textSpan(` — ${scope}`));
  return title;
}

function emptyPrompt(): HTMLElement {
  const prompt = document.createElement('div');
  prompt.className = 'zone-detail-empty';
  prompt.textContent = 'Select a zone cell or a pitch to see detail';
  return prompt;
}

function cellLabel(region: string, strikeBucket: number): string {
  return `${region.replace('_', '-')} · ${strikeBucket} strike${strikeBucket === 1 ? '' : 's'}`;
}

function pitchLocationLabel(pitch: Pitch): string | null {
  return pitch.region === null ? null : cellLabel(pitch.region, pitch.strike_bucket);
}

function tileRow(...tiles: HTMLElement[]): HTMLElement {
  const row = document.createElement('div');
  row.className = 'zone-detail-tiles';
  for (const t of tiles) row.appendChild(t);
  return row;
}

// Rates over every pitch in one region x strike bucket, with interval and n.
function cellTiles(cell: ZoneCell | undefined, state: State): HTMLElement {
  const noPitches = !cell || cell.pitches === 0;
  return tileRow(
    cell?.swing_rate
      ? tile('Swing%', pctDetail(cell.swing_rate.estimate), intervalSub(cell.swing_rate, pctDetail))
      : tile('Swing%', '—', noPitches ? 'no pitches' : ''),
    cell?.whiff_rate
      ? tile('Whiff%', pctDetail(cell.whiff_rate.estimate), intervalSub(cell.whiff_rate, pctDetail))
      : tile('Whiff%', '—', noPitches ? '' : 'no swings'),
    batSpeedTile(state, cell, noPitches),
  );
}

function batSpeedTile(state: State, cell: ZoneCell | undefined, noPitches: boolean): HTMLElement {
  if (!hasBatSpeedData(state)) return tile('Bat speed', '—', 'not tracked');
  if (cell?.bat_speed) {
    return tile(
      'Bat speed',
      mphDetail(cell.bat_speed.estimate),
      `${intervalSub(cell.bat_speed, oneDecimal)} · excl. bunts`,
    );
  }
  return tile('Bat speed', '—', noPitches ? '' : 'n < 2 swings');
}

function intervalSub(
  interval: { lo: number; hi: number; n: number },
  format: (value: number) => string,
): string {
  return `${format(interval.lo)}–${format(interval.hi)} · n=${interval.n}`;
}

// One pitch, described only by its own record: no rate, no interval, no n.
// The raw result string is the same text as that row's Pitch list cell, which
// is what ties the panel back to the row the reader just clicked.
function pitchTiles(pitch: Pitch, state: State): HTMLElement {
  return tileRow(
    tile('Decision', pitch.swing ? 'Swing' : 'Take', pitchTypeName(pitch.pitch_type)),
    textTile('Result', pitch.pitch_result ?? '—', `${pitch.balls}-${pitch.strikes} count`),
    pitchBatSpeedTile(pitch, state),
  );
}

function pitchBatSpeedTile(pitch: Pitch, state: State): HTMLElement {
  if (!hasBatSpeedData(state)) return tile('Bat speed', '—', 'not tracked');
  if (pitch.bat_speed === null) {
    return tile('Bat speed', '—', pitch.swing ? 'not measured' : 'no swing');
  }
  return tile('Bat speed', mphDetail(pitch.bat_speed), 'this swing');
}

function oneDecimal(value: number): string {
  return value.toFixed(1);
}

function mphDetail(mph: number): string {
  return `${oneDecimal(mph)} mph`;
}

function tile(label: string, value: string, sub: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'zone-tile';
  const labelDiv = document.createElement('div');
  labelDiv.className = 'zone-tile-label';
  labelDiv.textContent = label;
  box.appendChild(labelDiv);
  const valueDiv = document.createElement('div');
  valueDiv.className = 'zone-tile-value';
  valueDiv.textContent = value;
  box.appendChild(valueDiv);
  const subDiv = document.createElement('div');
  subDiv.className = 'zone-tile-sub';
  subDiv.innerHTML = sub || '&nbsp;';
  box.appendChild(subDiv);
  return box;
}

// Same tile, smaller value type: a phrase like "In play, out(s)" does not fit
// the numeric size, and setting it in that size reads as a measurement.
function textTile(label: string, value: string, sub: string): HTMLElement {
  const box = tile(label, value, sub);
  box.querySelector('.zone-tile-value')?.classList.add('is-text');
  return box;
}

function renderDiagram(
  strikeBucket: number,
  title: string,
  cellByKey: Map<string, ZoneCell>,
  state: State,
  selectedPitch: Pitch | null,
): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'zone-diagram';
  figure.style.margin = '0';

  const svg = select(document.createElementNS('http://www.w3.org/2000/svg', 'svg'))
    .attr('width', DIAGRAM_W)
    .attr('height', DIAGRAM_H)
    .attr('viewBox', `0 0 ${DIAGRAM_W} ${DIAGRAM_H}`);
  figure.appendChild(svg.node() as SVGSVGElement);

  // Hatch for no-pitch cells: a flat gray competes with the pale end of the
  // swing% ramp and reads as "never swings" instead of "no data".
  const hatchId = `zone-hatch-${strikeBucket}`;
  appendHatchPattern(svg, hatchId);

  const geo = geometry();
  const activeCell = state.selection?.kind === 'cell' ? state.selection : null;

  function drawCell(region: string, rect: Rect): void {
    const cell = cellByKey.get(`${region}_${strikeBucket}`);
    const hasData = !!cell && cell.pitches > 0 && cell.swing_rate !== null;
    const fill = hasData ? swingColor(cell!.swing_rate!.estimate) : `url(#${hatchId})`;
    const isSelected = activeCell !== null && activeCell.region === region && activeCell.strikeBucket === strikeBucket;
    const isPitchSelected =
      selectedPitch !== null && selectedPitch.region === region && selectedPitch.strike_bucket === strikeBucket;

    const rectSelection = svg
      .append('rect')
      .attr('class', `zone-cell${hasData ? '' : ' zero-n'}${isSelected || isPitchSelected ? ' selected' : ''}`)
      .attr('x', rect.x)
      .attr('y', rect.y)
      .attr('width', rect.w)
      .attr('height', rect.h)
      .attr('fill', fill)
      // a color from a handful of pitches is mostly noise; say so visually
      .attr('fill-opacity', hasData && cell!.pitches < LOW_N_PITCHES ? LOW_N_OPACITY : 1);

    if (hasData) {
      rectSelection.on('click', () => {
        replaceState({ selection: { kind: 'cell', region, strikeBucket } });
      });
    }

    if (cell && cell.pitches > 0) {
      const anchor = labelAnchor(region, rect);
      const text = svg
        .append('text')
        .attr('class', 'zone-cell-text')
        .attr('x', anchor.x)
        .attr('y', anchor.y)
        .attr('text-anchor', anchor.textAnchor)
        .style('pointer-events', 'none');
      text.append('tspan').attr('x', anchor.x).attr('dy', 0).text(cell.swing_rate ? pctText(cell.swing_rate.estimate) : '—');
      text
        .append('tspan')
        .attr('x', anchor.x)
        .attr('dy', 11)
        .text(`n=${cell.pitches}`);
    }
  }

  drawCell('waste', geo.outer);
  for (const [region, corner] of QUADRANTS) {
    drawCell(region, quadrantRect(geo.band, corner));
  }
  drawCell('heart', geo.heart);

  // No away/in captions here: the key diagram alongside carries both axes.

  const pos =
    selectedPitch && selectedPitch.strike_bucket === strikeBucket
      ? pitchMarkerPosition(selectedPitch, geo)
      : null;
  if (pos) {
    const size = 5;
    svg
      .append('line')
      .attr('class', 'pitch-marker')
      .attr('x1', pos.x - size)
      .attr('y1', pos.y - size)
      .attr('x2', pos.x + size)
      .attr('y2', pos.y + size);
    svg
      .append('line')
      .attr('class', 'pitch-marker')
      .attr('x1', pos.x - size)
      .attr('y1', pos.y + size)
      .attr('x2', pos.x + size)
      .attr('y2', pos.y - size);
  }

  const caption = document.createElement('figcaption');
  caption.textContent = title;
  figure.appendChild(caption);
  return figure;
}

function labelAnchor(region: string, rect: Rect): { x: number; y: number; textAnchor: 'start' | 'middle' | 'end' } {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  switch (region) {
    case 'heart':
      return { x: cx, y: cy + 3, textAnchor: 'middle' };
    case 'up_away':
      return { x: rect.x + 4, y: rect.y + 12, textAnchor: 'start' };
    case 'up_in':
      return { x: rect.x + rect.w - 4, y: rect.y + 12, textAnchor: 'end' };
    case 'down_away':
      return { x: rect.x + 4, y: rect.y + rect.h - 16, textAnchor: 'start' };
    case 'down_in':
      return { x: rect.x + rect.w - 4, y: rect.y + rect.h - 16, textAnchor: 'end' };
    default:
      return { x: rect.x + 6, y: rect.y + 14, textAnchor: 'start' };
  }
}

async function onFirstTimeThroughChange(checked: boolean): Promise<void> {
  const state = getState();
  // Clear the selection: a cell picked under one scope must not keep
  // filtering the pitch list under another.
  replaceState({ firstTimeThrough: checked, selection: null });
  if (!state.datasetKey || state.batterId === null) return;
  const token = nextRequestToken();
  try {
    const cells = await fetchZone(state.datasetKey, state.batterId, checked);
    if (!isCurrentRequest(token)) return;
    replaceState({ zoneCells: cells, error: null });
  } catch (err) {
    if (!isCurrentRequest(token)) return;
    replaceState({ error: err instanceof Error ? err.message : 'Failed to load zone data' });
  }
}
