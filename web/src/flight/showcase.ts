// Showcase screen: no numbers computed, only geometry and a detail card of
// raw values. Shares the dataset picker, API client and theme with the
// analysis screen, and nothing else. The screen keeps its own local state —
// the global store redraws by rebuilding DOM, which would destroy the WebGL
// context, so the mount is cached per dataset and re-attached.

import type { Dataset } from '../state';
import { fetchTrajectories, type TrajectoryField, type TrajectoryPlayer } from '../api';
import { el } from '../dom';
import { positionAt } from './trajectory';
import { PALETTE, fieldValue, prepare, type Prepared } from './data';
import { createScene, type PresetName, type SceneHandle } from './scene';
import { createSideView } from './sideView';
import { pitchTypeName } from '../pitchTypes';
import { OUTCOME_FAMILIES, outcomeFamily } from '../outcomes';

const REQUIRED = ['zone_time', 'rel_angle', 'rel_direction'];

let active: { key: string; mount: HTMLElement; dispose: () => void } | null = null;

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
    container.appendChild(active.mount);
    return;
  }
  active?.dispose();
  const mount = el('div', { className: 'showcase' }, note('Loading trajectories…'));
  let disposeInner: () => void = () => undefined;
  active = { key: dataset.key, mount, dispose: () => disposeInner() };
  container.appendChild(mount);
  fetchTrajectories(dataset.key)
    .then((payload) => {
      if (active?.mount !== mount) return; // superseded while in flight; never build
      mount.innerHTML = '';
      if (payload.count === 0) {
        mount.appendChild(note(`${dataset.name} has no pitches with all nine flight inputs.`));
        return;
      }
      disposeInner = build(mount, prepare(payload));
    })
    .catch((err: unknown) => {
      if (active?.mount !== mount) return;
      mount.innerHTML = '';
      mount.appendChild(note(err instanceof Error ? err.message : 'Failed to load trajectories'));
    });
}

const note = (text: string): HTMLElement => el('div', { className: 'disabled-note' }, text);

function build(root: HTMLElement, prepared: Prepared): () => void {
  const { payload } = prepared;
  const at = (i: number, name: TrajectoryField): number => fieldValue(payload, i, name);

  // Local filter state; every change rewrites one visibility array.
  let batter: number | null = null;
  let pitcher: number | null = null;
  const activeTypes = new Set<number>(payload.pitchTypes.map((_, t) => t));
  const buckets = new Set([0, 1, 2]);
  const sides = new Set([0, 1]);
  const hands = new Set([0, 1]);
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

  const toolbar = el('div', { className: 'showcase-toolbar' });
  root.appendChild(toolbar);

  const stage = el('div', { className: 'showcase-stage' });
  scene.canvas.className = 'showcase-canvas';
  stage.appendChild(scene.canvas);
  root.appendChild(stage);

  const countLabel = overlay(stage, 'showcase-count');
  const legend = overlay(stage, 'showcase-legend');
  const card = overlay(stage, 'showcase-card');

  // Below the stage, not over it: the brush reads better full-width, and it
  // stopped covering the part of the field the 3D view is actually about.
  root.appendChild(sideView.el);

  const scrubRow = el('div', { className: 'showcase-scrub' });
  root.appendChild(scrubRow);

  // --- toolbar -------------------------------------------------------------
  // The two player pickers cross-filter: every option carries its pitch count
  // under the *other* picker's selection, so picking a hitter turns the pitcher
  // list into the arms he actually faced, and a pair reads as one matchup. The
  // counts ignore the chip filters, the same way the legend's do: a chip toggle
  // rewriting a hundred option labels would be a lot of motion to read past.
  const batterPicker = playerPicker('Hitter', payload.batters, 'All hitters', (index) => {
    batter = index;
  });
  const pitcherPicker = playerPicker('Pitcher', payload.pitchers, 'All pitchers', (index) => {
    pitcher = index;
  });

  toolbar.appendChild(chipGroup('Stance', ['L', 'R'], sides, apply));
  toolbar.appendChild(chipGroup('Throws', ['L', 'R'], hands, apply));
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

  const playButton = el('button', { className: 'showcase-play' }, '❚❚ Pause');
  let playing = true;
  playButton.onclick = (): void => {
    playing = !playing;
    scene.setPlaying(playing);
    playButton.textContent = playing ? '❚❚ Pause' : '▶ Play';
  };
  toolbar.appendChild(labeled('Playback', playButton));

  const speedSelect = el('select');
  for (const s of ['0.25', '0.5', '1', '2']) addOption(speedSelect, s, `${s}×`, s === '1');
  speedSelect.onchange = (): void => scene.setSpeed(Number(speedSelect.value));
  toolbar.appendChild(labeled('Speed', speedSelect));

  // prettier-ignore
  const presets: Array<[PresetName, string]> = [
    ['broadcast', '3/4'], ['catcher', 'Catcher'], ['pitcher', 'Pitcher'], ['side', 'Side'], ['overhead', 'Top'],
  ];
  const cameras = el(
    'div',
    { className: 'seg-toggle' },
    ...presets.map(([name, label]) => el('button', { onclick: () => scene.flyTo(name) }, label)),
  );
  toolbar.appendChild(labeled('Camera', cameras));

  // --- legend: pitch-type chips double as filters --------------------------
  const typeButtons = new Map<number, HTMLElement>();
  const typeCountLabels = new Map<number, HTMLElement>();
  for (const typeIndex of prepared.typeOrder) {
    const dot = el('i');
    dot.style.background = PALETTE[prepared.typeSlot[typeIndex]];
    const count = el('span', { className: 'showcase-type-count' }, String(prepared.typeCounts[typeIndex]));
    const button = el(
      'button',
      // raw code on hover
      { className: 'showcase-type-chip active', title: payload.pitchTypes[typeIndex] },
      dot,
      pitchTypeName(payload.pitchTypes[typeIndex]),
      count,
    );
    button.onclick = (): void => {
      toggleFilter(activeTypes, typeIndex, payload.pitchTypes.length);
      typeButtons.forEach((b, t) => b.classList.toggle('active', activeTypes.has(t)));
      apply();
    };
    typeCountLabels.set(typeIndex, count);
    typeButtons.set(typeIndex, button);
    legend.appendChild(button);
  }

  // --- scrubber: one hitter's swings in game order --------------------------
  const scrubLabel = el('span', { className: 'showcase-scrub-label' });
  const scrubInput = el('input', { type: 'range', min: '0', step: '1' });
  let swings: number[] = [];
  scrubInput.oninput = (): void => {
    const pos = Number(scrubInput.value) / 100;
    const swingIndex = Math.min(Math.floor(pos), swings.length - 1);
    const frac = Math.min((pos - swingIndex) / 0.9, 1); // hold at contact
    const pitchIndex = swings[swingIndex];
    if (playing) playButton.click();
    select(pitchIndex, frac * prepared.endT[pitchIndex]);
    scrubLabel.textContent = `swing ${swingIndex + 1} of ${swings.length}`;
  };
  scrubRow.appendChild(scrubLabel);
  scrubRow.appendChild(scrubInput);

  /** A player picker sorted by surname; `refreshPickers` fills the option
   *  labels, and `assign` writes the pick into the matching filter. */
  function playerPicker(
    caption: string,
    players: TrajectoryPlayer[],
    allLabel: string,
    assign: (index: number | null) => void,
  ): Map<number, HTMLOptionElement> {
    const picker = el('select', { ariaLabel: caption });
    addOption(picker, '', allLabel, true);
    const options = new Map<number, HTMLOptionElement>();
    const bySurname = players
      .map((_, index) => index)
      .sort((a, b) => sortKey(players[a]).localeCompare(sortKey(players[b])));
    for (const index of bySurname) {
      const option = el('option', { value: String(index) });
      picker.appendChild(option);
      options.set(index, option);
    }
    picker.onchange = (): void => {
      assign(picker.value === '' ? null : Number(picker.value));
      select(null, null);
      refreshPickers();
      apply();
    };
    toolbar.appendChild(labeled(caption, picker));
    return options;
  }

  function refreshPickers(): void {
    const batterCounts = payload.batters.map(() => 0);
    const pitcherCounts = payload.pitchers.map(() => 0);
    for (let i = 0; i < payload.count; i++) {
      const b = at(i, 'batter_index');
      const p = at(i, 'pitcher_index');
      if (pitcher === null || p === pitcher) batterCounts[b] += 1;
      if (batter === null || b === batter) pitcherCounts[p] += 1;
    }
    labelOptions(batterPicker, payload.batters, batterCounts);
    labelOptions(pitcherPicker, payload.pitchers, pitcherCounts);
  }

  /** A player the counterpart never faced is disabled rather than dropped, so
   *  the list keeps its length and a name stays where it was last seen. */
  function labelOptions(
    options: Map<number, HTMLOptionElement>,
    players: TrajectoryPlayer[],
    counts: number[],
  ): void {
    options.forEach((option, index) => {
      option.textContent = `${players[index].name} · ${counts[index].toLocaleString()}`;
      option.disabled = counts[index] === 0;
    });
  }

  function refreshSwings(): void {
    swings = [];
    // One picker is enough for the sequence to mean something: a hitter's
    // swings, everyone's swings against one arm, or — both picked — that
    // matchup on its own.
    if (batter !== null || pitcher !== null) {
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
        : batter !== null || pitcher !== null
          ? 'No swings under these filters'
          : 'Pick a hitter or a pitcher to scrub through their swings';
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
        (pitcher === null || at(i, 'pitcher_index') === pitcher) &&
        buckets.has(Math.min(at(i, 'strikes'), 2)) &&
        handed(at(i, 'batter_side'), sides) &&
        handed(at(i, 'pitcher_side'), hands) &&
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
      card.textContent = 'Click a contact point, or scrub a hitter’s or pitcher’s swings';
      return;
    }
    card.classList.remove('empty');
    const i = selected;
    const batterName = payload.batters[at(i, 'batter_index')]?.name ?? '—';
    const typeCode = payload.pitchTypes[at(i, 'pitch_type_index')];
    const title = `${batterName} · ${pitchTypeName(typeCode)}`;
    // title attribute: raw pitch-type code on hover
    card.appendChild(el('div', { className: 'showcase-card-title', title: typeCode }, title));
    const contactX = at(i, 'contact_x');
    const release = positionAt(prepared.flights[i], 0);
    const pitcherName = payload.pitchers[at(i, 'pitcher_index')]?.name ?? '—';
    const throws = hand(at(i, 'pitcher_side'), 'LHP', 'RHP');
    const rows: Array<[string, string]> = [
      ['pitcher', `${pitcherName} · ${throws}`],
      [
        'count',
        `${at(i, 'balls')}–${at(i, 'strikes')}, bats ${hand(at(i, 'batter_side'), 'L', 'R')}`,
      ],
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
      card.appendChild(
        el('div', { className: 'showcase-card-row' }, el('span', {}, label), el('span', {}, value)),
      );
    }
  }

  const resizeObserver = new ResizeObserver(() => {
    scene.resize(stage.clientWidth, stage.clientHeight);
  });
  resizeObserver.observe(stage);
  scene.resize(stage.clientWidth || 960, stage.clientHeight || 540);

  refreshPickers();
  apply();
  renderCard();

  return () => {
    resizeObserver.disconnect();
    sideView.dispose();
    scene.dispose();
  };
}

function overlay(stage: HTMLElement, className: string): HTMLElement {
  const div = el('div', { className: `showcase-overlay ${className}` });
  stage.appendChild(div);
  return div;
}

function labeled(caption: string, control: HTMLElement): HTMLElement {
  return el('label', { className: 'picker' }, el('span', {}, caption), control);
}

function addOption(select: HTMLSelectElement, value: string, text: string, on: boolean): void {
  select.appendChild(el('option', { value, selected: on }, text));
}

/** The card names a side only when the file recorded one. */
function hand(side: number, left: string, right: string): string {
  if (!Number.isFinite(side)) return 'hand unrecorded';
  return side === 0 ? left : right;
}

/** A handedness chip pair filters what it can name. An unrecorded side arrives
 *  as NaN (api.py), and hiding it behind both chips would drop pitches nothing
 *  on screen says are missing, so it passes every setting. */
function handed(side: number, chips: Set<number>): boolean {
  return !Number.isFinite(side) || chips.has(side);
}

/** Surname first, then the full name, so the pickers read like a roster and two
 *  players sharing a surname still sort stably. */
function sortKey(player: TrajectoryPlayer): string {
  return `${player.last} ${player.name}`;
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
  const group = el('div', { className: 'seg-toggle' });
  labels.forEach((text, value) => {
    const button = el('button', { className: set.has(value) ? 'active' : '' }, text);
    if (titles[value]) button.title = titles[value];
    button.onclick = (): void => {
      toggleFilter(set, value, labels.length);
      Array.from(group.children).forEach((c, k) => (c.className = set.has(k) ? 'active' : ''));
      onChange();
    };
    group.appendChild(button);
  });
  return labeled(caption, group);
}
