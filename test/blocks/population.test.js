'use strict';

const { generate } = require('../../src/blocks/population');

describe('population block — generate()', () => {
  test('tam girdi → within_limit true', () => {
    const result = generate({
      population: {
        n_male: 70,
        n_female: 125,
        description: 'Adults with posterior canal BPPV canalolithiasis',
        mean_age: '62.6 y',
      },
    });
    expect(result.block).toBe('population');
    expect(result.within_limit).toBe(true);
    expect(result.word_count).toBeLessThanOrEqual(25);
  });

  test('population yoksa missing: true', () => {
    const result = generate({});
    expect(result.missing).toBe(true);
  });

  test('content cinsiyet bilgisini içerir', () => {
    const result = generate({
      population: { n_male: 70, n_female: 125, description: 'Adults with BPPV' },
    });
    expect(result.content).toContain('70 men');
    expect(result.content).toContain('125 women');
  });

  test('median_age kullanılır (mean_age yoksa)', () => {
    const result = generate({
      population: {
        n_male: 159,
        n_female: 235,
        description: 'Adults with chronic low back pain',
        median_age: '49.8 y',
        age_range: '40.7-55.8 y',
      },
    });
    expect(result.content).toContain('Median age');
    expect(result.content).toContain('49.8 y');
    expect(result.content).toContain('range');
    expect(result.within_limit).toBe(true);
  });

  test('mean_age range ile birlikte gösterilir', () => {
    const result = generate({
      population: {
        n_male: 54,
        n_female: 54,
        description: 'Children with severe amblyopia',
        mean_age: '5.2 y',
        age_range: '3-12 y',
      },
    });
    expect(result.content).toContain('Mean age');
    expect(result.content).toContain('5.2 y');
    expect(result.content).toContain('range');
  });
});
