// One immutable state object. Never mutated — always replaced wholesale.
// Views subscribe and fully redraw whenever it changes.

export interface DatasetColumn {
  column_name: string;
  is_derived: boolean;
  non_null_count: number;
  min_value: string | null;
  max_value: string | null;
}

export interface Dataset {
  key: string;
  name: string;
  source: string;
  start_date: string | null;
  end_date: string | null;
  row_count: number;
  is_reference: boolean;
  columns: DatasetColumn[];
}

export interface Batter {
  bam_id: number;
  name: string;
  pitches: number;
  swings: number;
  sides: string[];
}

export interface RateInterval {
  estimate: number;
  lo: number;
  hi: number;
  n: number;
}

export interface ZoneCell {
  region: string;
  strike_bucket: number;
  pitches: number;
  swings: number;
  whiffs: number;
  bat_speed: RateInterval | null;
  swing_rate: RateInterval | null;
  whiff_rate: RateInterval | null;
}

export interface BaselineRow {
  n_players: number;
  n_events: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface ReferenceWindow {
  key: string;
  name: string;
  start_date: string | null;
  end_date: string | null;
}

export interface RatesResponse {
  rates: {
    chase: RateInterval | null;
    whiff: RateInterval | null;
    in_zone_swing: RateInterval | null;
    hard_hit: RateInterval | null;
    bat_speed: RateInterval | null;
  };
  baselines: Partial<Record<string, BaselineRow>>;
  reference: ReferenceWindow | null;
}

export interface OverviewBatter {
  bam_id: number;
  name: string;
  sides: string[];
  pitches: number;
  swings: number;
  rates: {
    chase: RateInterval | null;
    whiff: RateInterval | null;
    in_zone_swing: RateInterval | null;
    hard_hit: RateInterval | null;
    bat_speed: RateInterval | null;
  };
}

export interface Pitch {
  id: number;
  at_bat_number: number;
  balls: number;
  strikes: number;
  pitch_seq: number;
  game_date: string;
  pitch_result: string | null;
  pitch_type: string | null;
  pitcher_pitch_no: number;
  /** This pitch's own swing flag and bat speed, not its zone cell's average. */
  swing: boolean;
  bat_speed: number | null;
  plate_z: number | null;
  region: string | null;
  strike_bucket: number;
  sz_bot: number | null;
  sz_top: number | null;
  /** Feet, positive toward the batter ("in"); see docs/DATA.md. */
  batter_relative_x_ft: number | null;
}

export type Selection =
  | { kind: 'cell'; region: string; strikeBucket: number }
  | { kind: 'pitch'; pitchId: number }
  | null;

export interface State {
  datasetKey: string | null;
  batterId: number | null;
  firstTimeThrough: boolean;
  datasets: Dataset[];
  batters: Batter[];
  overview: OverviewBatter[];
  zoneCells: ZoneCell[];
  rates: RatesResponse | null;
  pitches: Pitch[];
  selection: Selection;
  loading: boolean;
  error: string | null;
}

let state: State = {
  datasetKey: null,
  batterId: null,
  firstTimeThrough: false,
  datasets: [],
  batters: [],
  overview: [],
  zoneCells: [],
  rates: null,
  pitches: [],
  selection: null,
  loading: true,
  error: null,
};

type Listener = (next: State) => void;
const listeners: Listener[] = [];

export function getState(): State {
  return state;
}

export function subscribe(listener: Listener): void {
  listeners.push(listener);
}

export function replaceState(partial: Partial<State>): void {
  state = { ...state, ...partial };
  for (const listener of listeners) listener(state);
}

// Guard against stale fetches: every load takes a token, and a response only
// lands in state if no newer load has started since (main.ts, zoneMap.ts).
let latestRequestToken = 0;

export function nextRequestToken(): number {
  latestRequestToken += 1;
  return latestRequestToken;
}

export function isCurrentRequest(token: number): boolean {
  return token === latestRequestToken;
}
