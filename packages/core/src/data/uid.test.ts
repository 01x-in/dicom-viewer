import { describe, expect, it } from 'vitest';
import { assertDicomUid, isDicomUid } from './uid';

describe('isDicomUid', () => {
  it.each(['1.2.840.10008.1.2', '1', '2.25.123456789012345678901234567890123456789'])(
    'accepts %s',
    (uid) => {
      expect(isDicomUid(uid)).toBe(true);
    },
  );

  it.each([
    '',
    '1..2',
    '.1',
    '1.',
    '1.2/../3',
    '1.2?x=y',
    '1.2#a',
    '1 2',
    'a.b',
    '1.2\n3',
    `1.${'2'.repeat(64)}`,
  ])('rejects %j', (uid) => {
    expect(isDicomUid(uid)).toBe(false);
  });

  it('accepts exactly 64 characters', () => {
    expect(isDicomUid(`1.${'2'.repeat(62)}`)).toBe(true);
  });
});

describe('assertDicomUid', () => {
  it('names the field in the error, so a bad URL parameter is easy to find', () => {
    expect(() => {
      assertDicomUid('../x', 'StudyInstanceUID');
    }).toThrow(/StudyInstanceUID/);
    expect(() => {
      assertDicomUid('1.2.3', 'StudyInstanceUID');
    }).not.toThrow();
  });
});
