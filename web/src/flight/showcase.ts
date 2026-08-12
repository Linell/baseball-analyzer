// Showcase screen: no numbers computed, only geometry and a detail card of
// raw values. Shares the dataset picker, API client and theme with the
// analysis screen, and nothing else. The screen keeps its own local state —
// the global store redraws by rebuilding DOM, which would destroy the WebGL
// context, so the mount is cached per dataset and re-attached.

import type { Dataset } from '../state';
import { fetchTrajectories, type TrajectoryField } from '../api';
import { positionAt } from './trajectory';
import { PALETTE, fieldValue, prepare, type Prepared } from './data';
import { createScene, type PresetName, type SceneHandle } from './scene';
import { createSideView } from './sideView';
import { pitchTypeName } from '../pitchTypes';
import { OUTCOME_FAMILIES, outcomeFamily } from '../outcomes';

const REQUIRED = ['zone_time', 'rel_angle', 'rel_direction'];

let active: { key: string; el: HTMLElement; dispose: () => void } | null = null;

export function mountShowcase(container: HTMLElement, dataset: Dataset | null): void {
  if (!dataset) {
    container.appendChild(note('Loading…'));
    return;
  }
  const missing = REQUIRED.filter(
    (name) => !dataset.columns.some((c) => c.column_name === name && c.non_null_count > 0),
  );
  if (missing.length > 0) {
    const why = `it needs ${missing.join(', ')}, which this dataset does not carry`;
    container.appendChild(note(`Showcase is disabled for ${dataset.name}: ${why}.`));
    return;
  }
  if (active && active.key === dataset.key) {
    container.appendChild(active.el);
    return;
  }
  active?.dispose();
  const el = document.createElement('div');
  el.className = 'showcase';
  el.appendChild(note('Loading trajectories…'));
  let disposeInner: () => void = () => undefined;
  active = { key: dataset.key, el, dispose: () => disposeInner() };
  container.appendChild(el);
  fetchTrajectories(dataset.key)
    .then((payload) => {
      if (active?.el !== el) return; // superseded while in flight; never build
      el.innerHTML = '';
      if (payload.count === 0) {
        el.appendChild(note(`${dataset.name} has no pitches with all nine flight inputs.`));
        return;
      }
      disposeInner = build(el, prepare(payload));
    })
    .catch((err: unknown) => {
      if (active?.el !== el) return;
      el.innerHTML = '';
      el.appendChild(note(err instanceof Error ? err.message : 'Failed to load trajectories'));
    });
}

function el(tag: string, className: string, text = ''): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

const note = (text: string): HTMLElement => el('div', 'disabled-note', text);

function build(root: HTMLElement, prepared: Prepared): () => void {
  const { payload } = prepared;
  const at = (i: number, name: TrajectoryField): number => fieldValue(payload, i, name);

  // Local filter state; every change rewrites one visibility array.
  let batter: number | null = null;
  const activeTypes = new Set<number>(payload.pitchTypes.map((_, t) => t));
  const buckets = new Set([0, 1, 2]);
  const sides = new Set([0, 1]);
  let brush: Set<number> | null = null;
  let selected: number | null = null;
  const vis = new Uint8Array(payload.count).fill(1);

  // Outcome chips cover only the families this dataset actually contains, so a
  // chip index is not a family index; pitches map through their code table.
  const familyOfOutcome = payload.outcomes.map(outcomeFamily);
  const familyCounts = OUTCOME_FAMILIES.map(() => 0);
  for (let i = 0; i < payload.count; i++) {
    familyCounts[familyOfOutcome[at(i, 'outcome_index')]] += 1;
  }
  const chipFamilies = OUTCOME_FAMILIES.map((_, f) => f).filter((f) => familyCounts[f] > 0);
  const chipOfOutcome = familyOfOutcome.map((f) => chipFamilies.indexOf(f));
  const outcomes = new Set(chipFamilies.map((_, c) => c));

  const scene: SceneHandle = createScene(prepared, (picked) => select(picked, null));
  const sideView = createSideView(prepared, (indexes) => {
    brush = indexes;
    apply();
  });

  const toolbar = el('div', 'showcase-toolbar');
  root.appendChild(toolbar);

  const stage = el('div', 'showcase-stage');
  scene.canvas.className = 'showcase-canvas';
  stage.appendChild(scene.canvas);
  root.appendChild(stage);

  const countLabel = overlay(stage, 'showcase-count');
  const legend = overlay(stage, 'showcase-legend');
  const card = overlay(stage, 'showcase-card');

  // Below the stage, not over it: the brush reads better full-width, and it
  // stopped covering the part of the field the 3D view is actually about.
  root.appendChild(sideView.el);

  const scrubRow = el('div', 'showcase-scrub');
  root.appendChild(scrubRow);

  // --- toolbar -------------------------------------------------------------
  const batterSelect = document.createElement('select');
  batterSelect.setAttribute('aria-label', 'Hitter');
  addOption(batterSelect, '', 'All hitters', true);
  payload.batters.forEach((b, index) => addOption(batterSelect, String(index), b.name, false));
  batterSelect.addEventListener('change', () => {
    batter = batterSelect.value === '' ? null : Number(batterSelect.value);
    select(null, null);
    apply();
  });
  toolbar.appendChild(labeled('Hitter', batterSelect));

  toolbar.appendChild(chipGroup('Stance', ['L', 'R'], sides, apply));
  toolbar.appendChild(chipGroup('Strikes', ['0', '1', '2'], buckets, apply));
  toolbar.appendChild(
    chipGroup(
      'Outcome',
      chipFamilies.map((f) => OUTCOME_FAMILIES[f].label),
      outcomes,
      apply,
      chipFamilies.map((f) => `${familyCounts[f].toLocaleString()} pitches`),
    ),
  );

  const playButton = el('button', 'showcase-play', '❚❚ Pause');
  let playing = true;
  playButton.addEventListener('click', () => {
    playing = !playing;
    scene.setPlaying(playing);
    playButton.textContent = playing ? '❚❚ Pause' : '▶ Play';
  });
  toolbar.appendChild(labeled('Playback', playButton));

  const speedSelect = document.createElement('select');
  for (const s of ['0.25', '0.5', '1', '2']) addOption(speedSelect, s, `${s}×`, s === '1');
  speedSelect.addEventListener('change', () => scene.setSpeed(Number(speedSelect.value)));
  toolbar.appendChild(labeled('Speed', speedSelect));

  const cameras = el('div', 'seg-toggle');
  // prettier-ignore
  const presets: Array<[PresetName, string]> = [
    ['broadcast', '3/4'], ['catcher', 'Catcher'], ['pitcher', 'Pitcher'], ['side', 'Side'], ['overhead', 'Top'],
  ];
  for (const [name, label] of presets) {
    const button = el('button', '', label);
    button.addEventListener('click', () => scene.flyTo(name));
    cameras.appendChild(button);
  }
  toolbar.appendChild(labeled('Camera', cameras));

  // --- legend: pitch-type chips double as filters --------------------------
  const typeButtons = new Map<number, HTMLElement>();
  const typeCountLabels = new Map<number, HTMLElement>();
  for (const typeIndex of prepared.typeOrder) {
    const button = el('button', 'showcase-type-chip active');
    button.title = payload.pitchTypes[typeIndex]; // raw code on hover
    const dot = document.createElement('i');
    dot.style.background = PALETTE[prepared.typeSlot[typeIndex]];
    button.appendChild(dot);
    button.append(pitchTypeName(payload.pitchTypes[typeIndex]));
    const count = el('span', 'showcase-type-count', String(prepared.typeCounts[typeIndex]));
    button.appendChild(count);
    typeCountLabels.set(typeIndex, count);
    button.addEventListener('click', () => {
      toggleFilter(activeTypes, typeIndex, payload.pitchTypes.length);
      typeButtons.forEach((b, t) => b.classList.toggle('active', activeTypes.has(t)));
      apply();
    });
    typeButtons.set(typeIndex, button);
    legend.appendChild(button);
  }

  // --- scrubber: one hitter's swings in game order --------------------------
  const scrubLabel = el('span', 'showcase-scrub-label');
  const scrubInput = document.createElement('input');
  Object.assign(scrubInput, { type: 'range', min: '0', step: '1' });
  let swings: number[] = [];
  scrubInput.addEventListener('input', () => {
    const pos = Number(scrubInput.value) / 100;
    const swingIndex = Math.min(Math.floor(pos), swings.length - 1);
    const frac = Math.min((pos - swingIndex) / 0.9, 1); // hold at contact
    const pitchIndex = swings[swingIndex];
    if (playing) playButton.click();
    select(pitchIndex, frac * prepared.endT[pitchIndex]);
    scrubLabel.textContent = `swing ${swingIndex + 1} of ${swings.length}`;
  });
  scrubRow.appendChild(scrubLabel);
  scrubRow.appendChild(scrubInput);

  function refreshSwings(): void {
    swings = [];
    if (batter !== null) {
      // visible swings only, so the scrub ball never rides an invisible curve
      for (let i = 0; i < payload.count; i++) {
        if (vis[i] === 1 && at(i, 'swing') === 1) swings.push(i);
      }
    }
    scrubInput.disabled = swings.length === 0;
    scrubInput.max = String(Math.max(swings.length * 100 - 1, 0));
    scrubInput.value = '0';
    scrubLabel.textContent =
      swings.length > 0
        ? `${swings.length} swings — scrub to replay, each freezes at contact`
        : 'Pick a hitter to scrub through their swings';
  }

  function select(index: number | null, scrubT: number | null): void {
    selected = index;
    scene.setSelected(index);
    scene.setScrub(scrubT === null ? null : index, scrubT ?? 0);
    renderCard();
  }

  function apply(): void {
    let [visibleCount, szSum, szBotSum, szN] = [0, 0, 0, 0];
    // Legend counts ignore the pitch-type filter itself — a switched-off type
    // reading 0 would hide what turning it back on is worth.
    const typeVisible = payload.pitchTypes.map(() => 0);
    for (let i = 0; i < payload.count; i++) {
      const type = at(i, 'pitch_type_index');
      const others =
        (batter === null || at(i, 'batter_index') === batter) &&
        buckets.has(Math.min(at(i, 'strikes'), 2)) &&
        sides.has(at(i, 'batter_side')) &&
        outcomes.has(chipOfOutcome[at(i, 'outcome_index')]) &&
        (brush === null || brush.has(i));
      if (others) typeVisible[type] += 1;
      const on = others && activeTypes.has(type);
      vis[i] = on ? 1 : 0;
      if (on) {
        visibleCount += 1;
        const top = at(i, 'sz_top');
        const bot = at(i, 'sz_bot');
        if (Number.isFinite(top) && Number.isFinite(bot)) {
          [szSum, szBotSum, szN] = [szSum + top, szBotSum + bot, szN + 1];
        }
      }
    }
    typeCountLabels.forEach((label, typeIndex) => {
      label.textContent = typeVisible[typeIndex].toLocaleString();
      typeButtons.get(typeIndex)?.classList.toggle('empty', typeVisible[typeIndex] === 0);
    });
    scene.setVisibility(vis);
    sideView.redraw(vis);
    scene.setZone(szN > 0 ? szSum / szN : 3.4, szN > 0 ? szBotSum / szN : 1.6);
    countLabel.textContent =
      `${visibleCount.toLocaleString()} of ${payload.count.toLocaleString()} pitches` +
      (brush ? ' · brushed' : '');
    refreshSwings();
  }

  function renderCard(): void {
    card.innerHTML = '';
    if (selected === null) {
      card.classList.add('empty');
      card.textContent = 'Click a contact point, or scrub a hitter’s swings';
      return;
    }
    card.classList.remove('empty');
    const i = selected;
    const batterName = payload.batters[at(i, 'batter_index')]?.name ?? '—';
    const typeCode = payload.pitchTypes[at(i, 'pitch_type_index')];
    const title = `${batterName} · ${pitchTypeName(typeCode)}`;
    const titleEl = el('div', 'showcase-card-title', title);
    titleEl.title = typeCode; // raw code on hover
    card.appendChild(titleEl);
    const contactX = at(i, 'contact_x');
    const release = positionAt(prepared.flights[i], 0);
    const rows: Array<[string, string]> = [
      ['count', `${at(i, 'balls')}–${at(i, 'strikes')}, bats ${at(i, 'batter_side') ? 'R' : 'L'}`],
      ['outcome', payload.outcomes[at(i, 'outcome_index')] ?? '—'],
      ['release', `${at(i, 'rel_speed').toFixed(1)} mph`],
      [
        'release point',
        `${release.x.toFixed(2)}, ${release.z.toFixed(2)} ft · ext ${at(i, 'extension').toFixed(2)}`,
      ],
      ['zone time', `${at(i, 'zone_time').toFixed(3)} s`],
      ['at plate', `${at(i, 'plate_x').toFixed(2)}, ${at(i, 'plate_z').toFixed(2)} ft`],
    ];
    const contact = `${contactX.toFixed(2)}, ${at(i, 'contact_y').toFixed(2)}, ${at(i, 'contact_z').toFixed(2)} ft`;
    if (Number.isFinite(contactX)) rows.push(['contact', contact]);
    for (const [label, value] of rows) {
      const row = el('div', 'showcase-card-row');
      for (const text of [label, value]) row.appendChild(el('span', '', text));
      card.appendChild(row);
    }
  }

  const resizeObserver = new ResizeObserver(() => {
    scene.resize(stage.clientWidth, stage.clientHeight);
  });
  resizeObserver.observe(stage);
  scene.resize(stage.clientWidth || 960, stage.clientHeight || 540);

  apply();
  renderCard();

  return () => {
    resizeObserver.disconnect();
    sideView.dispose();
    scene.dispose();
  };
}

function overlay(stage: HTMLElement, className: string): HTMLElement {
  const div = el('div', `showcase-overlay ${className}`);
  stage.appendChild(div);
  return div;
}

function labeled(caption: string, control: HTMLElement): HTMLElement {
  const wrap = el('label', 'picker');
  wrap.appendChild(el('span', '', caption));
  wrap.appendChild(control);
  return wrap;
}

function addOption(select: HTMLSelectElement, value: string, text: string, on: boolean): void {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = text;
  option.selected = on;
  select.appendChild(option);
}

/** The one toggle rule for every filter set: emptying it resets to all. */
function toggleFilter(set: Set<number>, key: number, count: number): void {
  if (set.has(key)) set.delete(key);
  else set.add(key);
  if (set.size === 0) for (let k = 0; k < count; k++) set.add(k);
}

/** Multi-toggle chips over indexes 0..labels.length-1; empty resets to all. */
function chipGroup(
  caption: string,
  labels: string[],
  set: Set<number>,
  onChange: () => void,
  titles: string[] = [],
): HTMLElement {
  const group = document.createElement('div');
  group.className = 'seg-toggle';
  labels.forEach((text, value) => {
    const button = document.createElement('button');
    button.textContent = text;
    if (titles[value]) button.title = titles[value];
    button.className = set.has(value) ? 'active' : '';
    button.addEventListener('click', () => {
      toggleFilter(set, value, labels.length);
      Array.from(group.children).forEach((c, k) => (c.className = set.has(k) ? 'active' : ''));
      onChange();
    });
    group.appendChild(button);
  });
  return labeled(caption, group);
}
