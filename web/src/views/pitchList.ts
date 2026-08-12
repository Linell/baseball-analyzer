// Pitch list: every pitch in order, clickable, not sortable. Filters to the
// selected zone cell's region + strike bucket when one is selected.

import type { State } from '../state';
import { replaceState } from '../state';
import { pitchTypeName } from '../pitchTypes';

// Dot colors validated all-pairs with scripts/validate_palette.js (dataviz
// skill); the text label beside each dot carries identity, the color aids scan.
const RESULT_COLORS: Array<[prefix: string, cssVar: string]> = [
  ['in play', 'var(--result-inplay)'],
  ['foul', 'var(--result-foul)'],
  ['swinging strike', 'var(--result-swinging)'],
  ['missed bunt', 'var(--result-swinging)'],
  ['called strike', 'var(--result-called)'],
];

function resultColor(result: string | null): string {
  const lower = (result ?? '').toLowerCase();
  for (const [prefix, color] of RESULT_COLORS) {
    if (lower.startsWith(prefix)) return color;
  }
  return 'var(--result-take)';
}

export function renderPitchList(container: HTMLElement, state: State): void {
  container.innerHTML = '';
  const panel = document.createElement('div');
  panel.className = 'panel';
  container.appendChild(panel);

  const heading = document.createElement('h2');
  heading.textContent = 'Pitch list';
  panel.appendChild(heading);

  const filtered =
    state.selection?.kind === 'cell'
      ? state.pitches.filter(
          (p) => p.region === (state.selection as { region: string }).region &&
            p.strike_bucket === (state.selection as { strikeBucket: number }).strikeBucket,
        )
      : state.pitches;

  const count = document.createElement('div');
  count.className = 'pitch-list-count';
  count.textContent =
    filtered.length === state.pitches.length
      ? `${state.pitches.length} pitches`
      : `${filtered.length} of ${state.pitches.length} pitches (filtered by selected cell)`;
  panel.appendChild(count);

  const scroll = document.createElement('div');
  scroll.className = 'pitch-list-scroll';
  panel.appendChild(scroll);

  const table = document.createElement('table');
  table.className = 'pitch-table';
  scroll.appendChild(table);

  const thead = document.createElement('thead');
  thead.innerHTML =
    '<tr>' +
    '<th title="Balls-strikes before this pitch">Count</th>' +
    '<th title="Which of the three zone diagrams this pitch is in (0/1/2 strikes)">Diagram</th>' +
    "<th title=\"Pitch number within the pitcher's outing\">Pitch #</th>" +
    '<th title="Pitch type">Type</th>' +
    '<th>Result</th>' +
    '</tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  table.appendChild(tbody);

  const selectedPitchId = state.selection?.kind === 'pitch' ? state.selection.pitchId : null;
  let selectedRow: HTMLTableRowElement | null = null;

  for (const pitch of filtered) {
    const row = document.createElement('tr');
    if (pitch.id === selectedPitchId) {
      row.className = 'selected';
      selectedRow = row;
    }
    row.appendChild(cell(`${pitch.balls}-${pitch.strikes}`));
    row.appendChild(bucketCell(pitch.strike_bucket));
    row.appendChild(cell(String(pitch.pitcher_pitch_no)));
    row.appendChild(typeCell(pitch.pitch_type));
    row.appendChild(resultCell(pitch.pitch_result));
    row.addEventListener('click', () => {
      replaceState({ selection: { kind: 'pitch', pitchId: pitch.id } });
    });
    tbody.appendChild(row);
  }

  if (selectedRow) {
    selectedRow.scrollIntoView({ block: 'nearest' });
  }
}

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

// A three-square glyph mirroring the three zone diagrams: the filled square
// is the diagram this pitch lands in. No numeral — Count already ends in it.
function bucketCell(bucket: number): HTMLTableCellElement {
  const td = document.createElement('td');
  td.title = `${bucket} strike${bucket === 1 ? '' : 's'} diagram`;
  const glyph = document.createElement('span');
  glyph.className = 'bucket-glyph';
  for (let i = 0; i < 3; i++) {
    const square = document.createElement('i');
    if (i === bucket) square.className = 'on';
    glyph.appendChild(square);
  }
  td.appendChild(glyph);
  return td;
}

// Friendly name is the label; the raw code lives in the hover tooltip.
function typeCell(pitchType: string | null): HTMLTableCellElement {
  const td = cell(pitchTypeName(pitchType));
  if (pitchType) td.title = pitchType;
  return td;
}

function resultCell(result: string | null): HTMLTableCellElement {
  const td = document.createElement('td');
  const dot = document.createElement('span');
  dot.className = 'result-dot';
  dot.style.background = resultColor(result);
  td.appendChild(dot);
  td.appendChild(document.createTextNode(result ?? ''));
  return td;
}
