// Node tests over the real file — no GPU, no DB. Constant acceleration
// treats drag as uniform between release and the zone plane; these tests
// measure that error rather than assuming it away (docs/DESIGN.md, Showcase).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  solveFlight,
  positionAt,
  speedAt,
  timeAtY,
  ZONE_PLANE_Y,
  type TrajectoryInputs,
} from '../src/flight/trajectory';

const CSV = fileURLToPath(new URL('../../data/source_data.csv', import.meta.url));
const MPH = 5280 / 3600;

function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

interface Row {
  inputs: TrajectoryInputs;
  pitchType: string;
  zoneSpeed: number;
  plateTime: number;
  contactY: number | null;
}

function loadPitches(): Row[] {
  const lines = readFileSync(CSV, 'utf8').split(/\r?\n/).filter(Boolean);
  const header = parseLine(lines[0]);
  const col = new Map(header.map((h, i) => [h, i]));
  const get = (r: string[], name: string): number => Number(r[col.get(name)!]);
  const rows: Row[] = [];
  for (const line of lines.slice(1)) {
    const r = parseLine(line);
    if (r[col.get('is_pitch')!] !== 'TRUE') continue;
    rows.push({
      inputs: {
        relSide: get(r, 'rel_side'),
        extension: get(r, 'extension'),
        relHeight: get(r, 'rel_height'),
        relSpeed: get(r, 'rel_speed'),
        relAngle: get(r, 'rel_angle'),
        relDirection: get(r, 'rel_direction'),
        plateX: get(r, 'plate_x'),
        plateZ: get(r, 'plate_z'),
        zoneTime: get(r, 'zone_time'),
      },
      pitchType: r[col.get('pitch_type')!],
      zoneSpeed: get(r, 'zone_speed'),
      plateTime: get(r, 'plate_time'),
      contactY: r[col.get('hit_contact_y')!] === '' ? null : get(r, 'hit_contact_y'),
    });
  }
  return rows;
}

const pitches = loadPitches();

describe('solveFlight over all 6,431 pitches', () => {
  it('loads every pitch with all nine inputs — no null path', () => {
    expect(pitches.length).toBe(6431);
    for (const p of pitches) {
      for (const v of Object.values(p.inputs)) expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('hits (plate_x, 1.417, plate_z) at zone_time exactly — the solve is determined', () => {
    for (const p of pitches.slice(0, 500)) {
      const f = solveFlight(p.inputs);
      const end = positionAt(f, f.t1);
      expect(end.x).toBeCloseTo(p.inputs.plateX, 9);
      expect(end.y).toBeCloseTo(ZONE_PLANE_Y, 9);
      expect(end.z).toBeCloseTo(p.inputs.plateZ, 9);
    }
  });

  it('reconstructed speed at y = 1.417 matches measured zone_speed within 3 mph', () => {
    // zone_speed is not an input, so this checks the geometry independently.
    const errs = pitches
      .map((p) => {
        const f = solveFlight(p.inputs);
        return Math.abs(speedAt(f, f.t1) / MPH - p.zoneSpeed);
      })
      .sort((a, b) => a - b);
    expect(errs[Math.floor(errs.length * 0.5)]).toBeLessThan(1); // median 0.84
    expect(errs[Math.floor(errs.length * 0.95)]).toBeLessThan(3); // p95 2.98
    expect(errs[errs.length - 1]).toBeLessThan(6); // worst 5.07: uniform-drag error, measured
  });

  it('solved vertical acceleration orders four-seams above curveballs', () => {
    const mean = (type: string): number => {
      const az = pitches.filter((p) => p.pitchType === type).map((p) => solveFlight(p.inputs).a.z);
      return az.reduce((s, x) => s + x, 0) / az.length;
    };
    const fourSeam = mean('4S');
    const curveball = mean('CB');
    expect(fourSeam).toBeGreaterThan(curveball);
    expect(fourSeam).toBeGreaterThan(-32.17); // backspin lift beats gravity alone
    expect(curveball).toBeLessThan(-32.17); // topspin adds to it
  });

  it('timeAtY finds a contact time on every measured-contact pitch', () => {
    const contacts = pitches.filter((p) => p.contactY !== null);
    expect(contacts.length).toBeGreaterThan(2000);
    for (const p of contacts) {
      const f = solveFlight(p.inputs);
      const t = timeAtY(f, p.contactY!);
      expect(t).not.toBeNull();
      expect(positionAt(f, t!).y).toBeCloseTo(p.contactY!, 6);
    }
  });

  it('substituting plate_time still renders (finite everywhere), just wrong', () => {
    // plate_time runs to the plate tip at y = 0 while plate_x/plate_z are
    // measured at y = 1.417; the mistake must degrade, not crash.
    for (const p of pitches.slice(0, 200)) {
      const f = solveFlight({ ...p.inputs, zoneTime: p.plateTime });
      const end = positionAt(f, f.t1);
      for (const v of [end.x, end.y, end.z, speedAt(f, f.t1)]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});
