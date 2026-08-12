// Decoded payload -> solved flights plus the derived arrays every other
// flight module reads: draw end times, palette slots, side-view samples.

import type { TrajectoryField, TrajectoryPayload } from '../api';
import { solveFlight, positionAt, timeAtY, type Flight } from './trajectory';

// Dark-mode categorical slots (dataviz reference palette), assigned to pitch
// types in frequency order — fixed, never cycled. Validated against the
// canvas surface: all pairs pass adjacent CVD >= 8 and contrast >= 3:1.
// A ninth-or-later type folds to the muted gray, per the eight-slot cap.
// prettier-ignore
export const PALETTE = [
  '#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767', '#898781',
];
export const CANVAS_BG = '#14161a';

export const SIDE_SAMPLES = 12;

export interface Prepared {
  payload: TrajectoryPayload;
  flights: Flight[];
  /** Seconds of flight to draw: zone_time, or contact time when measured. */
  endT: Float32Array;
  /** Palette slot per pitch type index (frequency-ranked, ninth+ folds). */
  typeSlot: Uint8Array;
  /** Palette slot per pitch, so hot paths skip the field lookup. */
  slotByPitch: Uint8Array;
  /** Pitch type indexes in descending frequency, for the legend. */
  typeOrder: number[];
  typeCounts: number[];
  /** (y, z) pairs, SIDE_SAMPLES per pitch, for the side view and its brush. */
  samples: Float32Array;
  /** Indexes of pitches with a measured 3D contact point, in game order. */
  contactIndexes: number[];
}

export function fieldValue(p: TrajectoryPayload, i: number, name: TrajectoryField): number {
  return p.data[i * p.stride + p.field[name]];
}

export function prepare(payload: TrajectoryPayload): Prepared {
  const n = payload.count;
  const flights: Flight[] = new Array(n);
  const endT = new Float32Array(n);
  const samples = new Float32Array(n * SIDE_SAMPLES * 2);
  const contactIndexes: number[] = [];
  const typeCounts = new Array(payload.pitchTypes.length).fill(0) as number[];

  for (let i = 0; i < n; i++) {
    const at = (name: TrajectoryField): number => fieldValue(payload, i, name);
    const flight = solveFlight({
      relSide: at('rel_side'),
      extension: at('extension'),
      relHeight: at('rel_height'),
      relSpeed: at('rel_speed'),
      relAngle: at('rel_angle'),
      relDirection: at('rel_direction'),
      plateX: at('plate_x'),
      plateZ: at('plate_z'),
      zoneTime: at('zone_time'),
    });
    flights[i] = flight;
    typeCounts[at('pitch_type_index')] += 1;

    // Swing trajectories terminate at their measured contact point, so the
    // contact cloud is the set of endpoints (docs/DESIGN.md, Showcase).
    const contactY = at('contact_y');
    endT[i] = flight.t1;
    if (Number.isFinite(contactY)) {
      contactIndexes.push(i);
      const tContact = timeAtY(flight, contactY);
      if (tContact !== null) endT[i] = tContact;
    }

    for (let k = 0; k < SIDE_SAMPLES; k++) {
      const p = positionAt(flight, (k / (SIDE_SAMPLES - 1)) * endT[i]);
      samples[(i * SIDE_SAMPLES + k) * 2] = p.y;
      samples[(i * SIDE_SAMPLES + k) * 2 + 1] = p.z;
    }
  }

  const typeOrder = typeCounts.map((_, t) => t).sort((a, b) => typeCounts[b] - typeCounts[a]);
  const typeSlot = new Uint8Array(payload.pitchTypes.length);
  typeOrder.forEach((typeIndex, rank) => {
    typeSlot[typeIndex] = Math.min(rank, PALETTE.length - 1);
  });
  const slotByPitch = new Uint8Array(n);
  for (let i = 0; i < n; i++) slotByPitch[i] = typeSlot[fieldValue(payload, i, 'pitch_type_index')];

  // prettier-ignore
  return { payload, flights, endT, typeSlot, slotByPitch, typeOrder, typeCounts, samples, contactIndexes };
}
