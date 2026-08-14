// Raw pitch_result strings collapse into the six families a flight view can
// actually be read by: did it end in the zone, in a swing, or in the field.
// Unknown or missing codes land in "Other" rather than vanishing.

export interface OutcomeFamily {
  key: string;
  label: string;
}

// prettier-ignore
export const OUTCOME_FAMILIES: OutcomeFamily[] = [
  { key: 'ball', label: 'Ball' },
  { key: 'called', label: 'Called' },
  { key: 'whiff', label: 'Whiff' },
  { key: 'foul', label: 'Foul' },
  { key: 'inplay', label: 'In play' },
  { key: 'other', label: 'Other' },
];

const FAMILY_ORDER = OUTCOME_FAMILIES.map((f) => f.key);

export function outcomeFamily(code: string | null | undefined): number {
  const text = (code ?? '').trim();
  let key = 'other';
  if (text.startsWith('In play')) key = 'inplay';
  else if (text.startsWith('Foul')) key = 'foul';
  else if (text.includes('Swinging Strike') || text === 'Missed Bunt') key = 'whiff';
  else if (text === 'Called Strike') key = 'called';
  else if (text === 'Ball' || text === 'Ball In Dirt' || text.startsWith('Automatic Ball')) {
    key = 'ball';
  }
  return FAMILY_ORDER.indexOf(key);
}
