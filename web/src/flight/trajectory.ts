// Pure trajectory reconstruction from nine measured numbers (docs/DESIGN.md,
// Showcase). No renderer imports; unit-tested in Node without a GPU.
//
// Data coordinates: x in feet, positive toward the catcher's left; y is
// distance from the plate tip toward the mound; z is height. plate_x/plate_z
// are measured at the zone plane y = 1.417, reached at t = zone_time — which
// is why zone_time is the right time input and plate_time (to y = 0) is not.

export interface TrajectoryInputs {
  relSide: number; // release x, ft
  extension: number; // ft toward the plate off the 60.5 ft rubber
  relHeight: number; // release z, ft
  relSpeed: number; // mph
  relAngle: number; // vertical release angle, degrees
  relDirection: number; // horizontal release angle, degrees
  plateX: number; // ft at the zone plane
  plateZ: number; // ft at the zone plane
  zoneTime: number; // seconds from release to the zone plane
}

export interface Vec3 { x: number; y: number; z: number } // prettier-ignore

/** p(t) = p0 + v0 t + ½ a t², exactly determined — no fitting. */
export interface Flight {
  p0: Vec3;
  v0: Vec3;
  a: Vec3;
  t1: number; // time at the zone plane
}

export const ZONE_PLANE_Y = 1.417;
const FT_PER_S_PER_MPH = 5280 / 3600;
const RAD = Math.PI / 180;

export function solveFlight(inputs: TrajectoryInputs): Flight {
  const p0: Vec3 = { x: inputs.relSide, y: 60.5 - inputs.extension, z: inputs.relHeight };
  const speed = inputs.relSpeed * FT_PER_S_PER_MPH;
  const ra = inputs.relAngle * RAD;
  const rd = inputs.relDirection * RAD;
  const v0: Vec3 = {
    x: speed * Math.cos(ra) * Math.sin(rd),
    y: -speed * Math.cos(ra) * Math.cos(rd),
    z: speed * Math.sin(ra),
  };
  const t = inputs.zoneTime;
  const p1: Vec3 = { x: inputs.plateX, y: ZONE_PLANE_Y, z: inputs.plateZ };
  const a: Vec3 = {
    x: (2 * (p1.x - p0.x - v0.x * t)) / (t * t),
    y: (2 * (p1.y - p0.y - v0.y * t)) / (t * t),
    z: (2 * (p1.z - p0.z - v0.z * t)) / (t * t),
  };
  return { p0, v0, a, t1: t };
}

export function positionAt(f: Flight, t: number): Vec3 {
  const h = 0.5 * t * t;
  return {
    x: f.p0.x + f.v0.x * t + f.a.x * h,
    y: f.p0.y + f.v0.y * t + f.a.y * h,
    z: f.p0.z + f.v0.z * t + f.a.z * h,
  };
}

/** ft/s at time t; divide by 5280/3600 for mph. */
export function speedAt(f: Flight, t: number): number {
  const vx = f.v0.x + f.a.x * t;
  const vy = f.v0.y + f.a.y * t;
  const vz = f.v0.z + f.a.z * t;
  return Math.hypot(vx, vy, vz);
}

/**
 * Earliest positive time the flight crosses depth y (ball travels toward
 * decreasing y). Null when the path never reaches it — a swing's measured
 * contact sits near the plate, so real inputs always resolve.
 */
export function timeAtY(f: Flight, y: number): number | null {
  const half = 0.5 * f.a.y;
  const c = f.p0.y - y;
  if (Math.abs(half) < 1e-9) {
    const t = -c / f.v0.y;
    return t > 0 ? t : null;
  }
  const disc = f.v0.y * f.v0.y - 4 * half * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const roots = [(-f.v0.y - sq) / (2 * half), (-f.v0.y + sq) / (2 * half)]
    .filter((t) => t > 0)
    .sort((lo, hi) => lo - hi);
  return roots[0] ?? null;
}
