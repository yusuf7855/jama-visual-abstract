'use strict';

const { generate } = require('../../src/blocks/findings');

const BASE_STUDY = {
  findings: {
    summary: 'Fewer days until free of positional vertigo with Semont-plus vs Epley',
    results: [
      { arm: 'Epley maneuver', metric: 'mean (SD)', value: '3.3 (3.6) d' },
      { arm: 'Semont-plus maneuver', metric: 'mean (SD)', value: '2.0 (1.6) d' },
    ],
    p_value: 'P=.01',
  },
};

describe('findings block — generate()', () => {
  test('normal girdi → within_limit true', () => {
    const result = generate(BASE_STUDY);
    expect(result.block).toBe('findings');
    expect(result.within_limit).toBe(true);
    expect(result.word_count).toBeLessThanOrEqual(50);
  });

  test('hard_locked_values p_value içerir', () => {
    const result = generate(BASE_STUDY);
    expect(result.hard_locked_values).toContain('P=.01');
  });

  test('hard_locked_values sonuç değerlerini içerir', () => {
    const result = generate(BASE_STUDY);
    expect(result.hard_locked_values).toContain('3.3 (3.6) d');
    expect(result.hard_locked_values).toContain('2.0 (1.6) d');
  });

  test('findings yoksa missing: true döner', () => {
    const result = generate({});
    expect(result.missing).toBe(true);
    expect(result.content).toBeNull();
  });

  test('uzun summary kelime sıfatları kısa kesilir, sayılar korunur', () => {
    const overlimit = {
      findings: {
        summary:
          'There were significantly and notably fewer number of days until patients were completely free of positional vertigo symptoms in the Semont-plus maneuver group as compared to the Epley maneuver group, which is a remarkable and clinically meaningful finding observed across all three study centers',
        results: [
          { arm: 'Epley maneuver', metric: 'mean (SD)', value: '3.3 (3.6) d' },
          { arm: 'Semont-plus maneuver', metric: 'mean (SD)', value: '2.0 (1.6) d' },
        ],
        p_value: 'P=.01',
      },
    };
    const result = generate(overlimit);
    expect(result.word_count).toBeLessThanOrEqual(50);
    // Sayılar korunmuş olmalı
    expect(result.content).toContain('P=.01');
  });

  test('TRUNCATION_IMPOSSIBLE fırlatılır — 26 kol + p_value, minimum içerik > 50 token', () => {
    // Her kol "X: mean (SD), Y d" → 2 JAMA token. 26 kol = 52 token + p_value = 53 > 50.
    const arms = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter, i) => ({
      arm: letter,
      metric: 'mean (SD)',
      value: `${(i + 1)}.0 (0.5) d`,
    }));
    const impossible = {
      findings: { summary: '', results: arms, p_value: 'P=.001' },
    };
    expect(() => generate(impossible)).toThrow('TRUNCATION_IMPOSSIBLE');
  });
});
