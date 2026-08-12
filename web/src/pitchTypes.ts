// Friendly names for the pitch-type codes that appear in TrackMan/Statcast
// exports. Unknown codes fall back to the raw code so new abbreviations
// still render.

export const PITCH_TYPE_NAMES: Record<string, string> = {
  '4S': 'Four-seam fastball',
  '2S': 'Two-seam fastball',
  FF: 'Four-seam fastball',
  SI: 'Sinker',
  CT: 'Cutter',
  FC: 'Cutter',
  SL: 'Slider',
  SW: 'Sweeper',
  CB: 'Curveball',
  CU: 'Curveball',
  KC: 'Knuckle-curve',
  CH: 'Changeup',
  SP: 'Splitter',
  FS: 'Splitter',
  KN: 'Knuckleball',
};

export function pitchTypeName(code: string | null | undefined): string {
  if (!code) return '';
  return PITCH_TYPE_NAMES[code] ?? code;
}
