// Every pitch_result string the dataset carries must land in exactly one
// family — a code that silently falls to "Other" would quietly hide pitches
// behind a chip nobody thinks to click.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OUTCOME_FAMILIES, outcomeFamily } from '../src/outcomes';

const CSV = fileURLToPath(new URL('../../data/source_data.csv', import.meta.url));

const familyKey = (code: string): string => OUTCOME_FAMILIES[outcomeFamily(code)].key;

/** Minimal RFC 4180 split — pitch_result is quoted and holds commas. */
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

describe('outcomeFamily', () => {
  it('maps the codes in the shipped dataset', () => {
    expect(familyKey('Ball')).toBe('ball');
    expect(familyKey('Ball In Dirt')).toBe('ball');
    expect(familyKey('Automatic Ball - Intentional')).toBe('ball');
    expect(familyKey('Called Strike')).toBe('called');
    expect(familyKey('Swinging Strike')).toBe('whiff');
    expect(familyKey('Swinging Strike (Blocked)')).toBe('whiff');
    expect(familyKey('Missed Bunt')).toBe('whiff');
    expect(familyKey('Foul')).toBe('foul');
    expect(familyKey('Foul Tip')).toBe('foul');
    expect(familyKey('Foul Bunt')).toBe('foul');
    expect(familyKey('In play, out(s)')).toBe('inplay');
    expect(familyKey('In play, no out')).toBe('inplay');
    expect(familyKey('In play, run(s)')).toBe('inplay');
  });

  it('falls back to Other for unknown, empty and missing codes', () => {
    expect(familyKey('Pitcher Step Off')).toBe('other');
    expect(familyKey('Hit By Pitch')).toBe('other');
    expect(familyKey('')).toBe('other');
    expect(OUTCOME_FAMILIES[outcomeFamily(null)].key).toBe('other');
  });

  it('leaves at most the known oddballs unclassified across the CSV', () => {
    const text = readFileSync(CSV, 'utf8');
    const lines = text.split('\n');
    const column = parseLine(lines[0]).indexOf('pitch_result');
    expect(column).toBeGreaterThan(-1);

    const unmapped = new Set<string>();
    for (const line of lines.slice(1)) {
      if (!line.trim()) continue;
      const code = parseLine(line)[column];
      if (code !== undefined && familyKey(code) === 'other') unmapped.add(code);
    }
    expect([...unmapped].sort()).toEqual(['', 'Hit By Pitch', 'Pitcher Step Off']);
  });
});
