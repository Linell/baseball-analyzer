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
