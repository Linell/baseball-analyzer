// Typed fetchers matching the Flask API's real response shapes exactly.

import type { Dataset, Batter, OverviewBatter, ZoneCell, RatesResponse, Pitch } from './state';

async function getResponse(url: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(`Could not reach the server for ${url}`);
  }
  if (!response.ok) {
    throw new Error(`${url} failed: ${response.status} ${response.statusText}`);
  }
  return response;
}

async function getJson<T>(url: string): Promise<T> {
  return (await (await getResponse(url)).json()) as T;
}

export async function fetchDatasets(): Promise<Dataset[]> {
  const body = await getJson<{ datasets: Dataset[] }>('/datasets');
  return body.datasets;
}

export async function fetchBatters(datasetKey: string): Promise<Batter[]> {
  const body = await getJson<{ batters: Batter[] }>(
    `/batters?dataset=${encodeURIComponent(datasetKey)}`,
  );
  return body.batters;
}

export async function fetchOverview(datasetKey: string): Promise<OverviewBatter[]> {
  const body = await getJson<{ batters: OverviewBatter[] }>(
    `/overview?dataset=${encodeURIComponent(datasetKey)}`,
  );
  return body.batters;
}

export async function fetchZone(
  datasetKey: string,
  batterId: number,
  firstTimeThrough: boolean,
): Promise<ZoneCell[]> {
  const tto = firstTimeThrough ? '&tto=1' : '';
  const body = await getJson<{ cells: ZoneCell[] }>(
    `/zone?dataset=${encodeURIComponent(datasetKey)}&batter=${batterId}${tto}`,
  );
  return body.cells;
}

export async function fetchRates(
  datasetKey: string,
  batterId: number,
): Promise<RatesResponse> {
  return getJson<RatesResponse>(
    `/rates?dataset=${encodeURIComponent(datasetKey)}&batter=${batterId}`,
  );
}

// /trajectories body: uint32 LE header length, UTF-8 JSON header, then
// count × stride little-endian float32 values (api.py, TRAJECTORY_LAYOUT).
// The union mirrors TRAJECTORY_LAYOUT so a misspelled field name is a compile
// error rather than a silent NaN read.
// prettier-ignore
export type TrajectoryField =
  | 'rel_side' | 'extension' | 'rel_height' | 'rel_speed' | 'rel_angle' | 'rel_direction'
  | 'plate_x' | 'plate_z' | 'zone_time' | 'pitch_id' | 'batter_index' | 'batter_side'
  | 'pitcher_index' | 'pitcher_side'
  | 'pitch_type_index' | 'balls' | 'strikes' | 'outcome_index' | 'swing'
  | 'contact_x' | 'contact_y' | 'contact_z' | 'sz_top' | 'sz_bot';

/** An entry in the batter or pitcher code table the per-pitch indexes point into. */
export interface TrajectoryPlayer {
  bam_id: number;
  name: string;
  /** The pickers' sort key: the surname alone, so they need not split `name`
   *  apart, falling back to the whole name when the file records none. */
  last: string;
  /** Full team name; the pickers group by whether it matches `focusTeam`. */
  team: string | null;
}

export interface TrajectoryPayload {
  count: number;
  stride: number;
  /** field name -> offset within a record */
  field: Record<TrajectoryField, number>;
  data: Float32Array;
  pitchTypes: string[];
  outcomes: string[];
  batters: TrajectoryPlayer[];
  pitchers: TrajectoryPlayer[];
  /** The one team on the field in every game, or null when there isn't one. */
  focusTeam: string | null;
}

interface TrajectoryHeader {
  count: number;
  stride: number;
  fields: string[];
  pitch_types: string[];
  outcomes: string[];
  batters: TrajectoryPlayer[];
  pitchers: TrajectoryPlayer[];
  focus_team: string | null;
}

export async function fetchTrajectories(datasetKey: string): Promise<TrajectoryPayload> {
  const url = `/trajectories?dataset=${encodeURIComponent(datasetKey)}`;
  const buffer = await (await getResponse(url)).arrayBuffer();
  const headerLength = new DataView(buffer).getUint32(0, true);
  const header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)),
  ) as TrajectoryHeader;
  // slice: the float block starts at 4 + headerLength, not always 4-aligned
  const data = new Float32Array(buffer.slice(4 + headerLength));
  if (data.length !== header.count * header.stride) {
    throw new Error(`${url} returned a malformed payload`);
  }
  const field = {} as Record<TrajectoryField, number>;
  header.fields.forEach((name, offset) => {
    field[name as TrajectoryField] = offset;
  });
  return {
    count: header.count,
    stride: header.stride,
    field,
    data,
    pitchTypes: header.pitch_types,
    outcomes: header.outcomes,
    batters: header.batters,
    pitchers: header.pitchers,
    focusTeam: header.focus_team,
  };
}

export async function fetchPitches(
  datasetKey: string,
  batterId: number,
): Promise<Pitch[]> {
  const body = await getJson<{ pitches: Pitch[] }>(
    `/pitches?dataset=${encodeURIComponent(datasetKey)}&batter=${batterId}`,
  );
  return body.pitches;
}
