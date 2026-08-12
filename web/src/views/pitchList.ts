// Pitch list: every pitch in order, clickable, not sortable. Filters to the
// selected zone cell's region + strike bucket when one is selected.

import { el } from '../dom';
import type { Pitch, State } from '../state';
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

  const filtered =
    state.selection?.kind === 'cell'
      ? state.pitches.filter(
          (p) => p.region === (state.selection as { region: string }).region &&
            p.strike_bucket === (state.selection as { strikeBucket: number }).strikeBucket,
        )
      : state.pitches;

  const countText =
    filtered.length === state.pitches.length
      ? `${state.pitches.length} pitches`
      : `${filtered.length} of ${state.pitches.length} pitches (filtered by selected cell)`;

  const selectedPitchId = state.selection?.kind === 'pitch' ? state.selection.pitchId : null;
  let selectedRow: HTMLTableRowElement | null = null;

  const tbody = el('tbody');
  for (const pitch of filtered) {
    const row = pitchRow(pitch, pitch.id === selectedPitchId);
    if (pitch.id === selectedPitchId) selectedRow = row;
    tbody.appendChild(row);
  }

  container.appendChild(
    el(
      'div',
      { className: 'panel' },
      el('h2', {}, 'Pitch list'),
      el('div', { className: 'pitch-list-count' }, countText),
      el(
        'div',
        { className: 'pitch-list-scroll' },
        el('table', { className: 'pitch-table' }, tableHead(), tbody),
      ),
    ),
  );

  if (selectedRow) {
    selectedRow.scrollIntoView({ block: 'nearest' });
  }
}

function tableHead(): HTMLElement {
  return el(
    'thead',
    {},
    el(
      'tr',
      {},
      el('th', { title: 'Balls-strikes before this pitch' }, 'Count'),
      el('th', { title: 'Which of the three zone diagrams this pitch is in (0/1/2 strikes)' }, 'Diagram'),
      el('th', { title: "Pitch number within the pitcher's outing" }, 'Pitch #'),
      el('th', { title: 'Pitch type' }, 'Type'),
      el('th', {}, 'Result'),
    ),
  );
}

function pitchRow(pitch: Pitch, selected: boolean): HTMLTableRowElement {
  return el(
    'tr',
    {
      className: selected ? 'selected' : '',
      onclick: () => replaceState({ selection: { kind: 'pitch', pitchId: pitch.id } }),
    },
    el('td', {}, `${pitch.balls}-${pitch.strikes}`),
    bucketCell(pitch.strike_bucket),
    el('td', {}, String(pitch.pitcher_pitch_no)),
    typeCell(pitch.pitch_type),
    resultCell(pitch.pitch_result),
  );
}

// A three-square glyph mirroring the three zone diagrams: the filled square
// is the diagram this pitch lands in. No numeral — Count already ends in it.
function bucketCell(bucket: number): HTMLTableCellElement {
  const glyph = el('span', { className: 'bucket-glyph' });
  for (let i = 0; i < 3; i++) {
    glyph.appendChild(el('i', { className: i === bucket ? 'on' : '' }));
  }
  return el('td', { title: `${bucket} strike${bucket === 1 ? '' : 's'} diagram` }, glyph);
}

// Friendly name is the label; the raw code lives in the hover tooltip.
function typeCell(pitchType: string | null): HTMLTableCellElement {
  return el('td', pitchType ? { title: pitchType } : {}, pitchTypeName(pitchType));
}

function resultCell(result: string | null): HTMLTableCellElement {
  const dot = el('span', { className: 'result-dot' });
  dot.style.background = resultColor(result);
  return el('td', {}, dot, result ?? '');
}
