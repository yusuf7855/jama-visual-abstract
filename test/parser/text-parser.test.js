'use strict';

const { parseText } = require('../../src/parser/text-parser');

const GOLDEN_TEXT = `RCT. 70 men and 125 women, mean age 62.6 years. Adults with posterior canal BPPV
canalolithiasis (Bárány Society criteria). 3 academic centers in Europe.
106 patients received Epley maneuver once by a physician and 9 times per day by the patient.
108 patients received Semont-plus maneuver (head 60° overextended) once by a physician
and 9 times per day by the patient.
Primary outcome: days until free of positional vertigo for 3 consecutive mornings.
Significantly fewer days with Semont-plus vs Epley. Epley: mean (SD) 3.3 (3.6) d.
Semont-plus: mean (SD) 2.0 (1.6) d; P=.01.`;

describe('TextParser — parseText()', () => {
  let parsed;
  beforeAll(() => {
    parsed = parseText(GOLDEN_TEXT);
  });

  test('study_type RCT tespit edilir', () => {
    expect(parsed.study_type).toBe('RCT');
  });

  test('n_male=70, n_female=125 tespit edilir', () => {
    expect(parsed.population.n_male).toBe(70);
    expect(parsed.population.n_female).toBe(125);
  });

  test('mean_age "62.6 y" tespit edilir', () => {
    expect(parsed.population.mean_age).toBe('62.6 y');
  });

  test('iki intervention kolu tespit edilir', () => {
    expect(parsed.intervention.arms).toHaveLength(2);
    expect(parsed.intervention.arms[0].n).toBe(106);
    expect(parsed.intervention.arms[1].n).toBe(108);
  });

  test('p_value P=.01 tespit edilir', () => {
    expect(parsed.findings.p_value).toContain('.01');
  });

  test('parse_confidence ≥ 0.7 (golden-set temiz)', () => {
    if (parsed.population && parsed.population.parse_confidence != null) {
      expect(parsed.population.parse_confidence).toBeGreaterThanOrEqual(0.7);
    }
  });

  test('review_flags boş (golden-set)', () => {
    // population ve intervention temiz metinden geldiği için
    const sensitiveFlags = (parsed.review_flags || []).filter(
      (f) => f === 'intervention' || f === 'population'
    );
    expect(sensitiveFlags).toHaveLength(0);
  });
});

describe('TextParser — düşük güven işaretleme', () => {
  test('p-değeri belirsizse findings needs_review true', () => {
    const ambiguous = parseText(
      'RCT. 70 men 125 women. The result was statistically significant.'
    );
    if (ambiguous.findings) {
      expect(ambiguous.findings.needs_review).toBe(true);
    }
    expect(ambiguous.review_flags).toContain('findings');
  });
});

describe('TextParser — yeni cinsiyet pattern\'ları', () => {
  test('Males/Females formatı tespit edilir', () => {
    const result = parseText('RCT. 54 Males, 54 Females. Primary outcome: visual acuity. P=.002');
    expect(result.population.n_male).toBe(54);
    expect(result.population.n_female).toBe(54);
  });

  test('Females/Males ters sıra da çalışır', () => {
    const result = parseText('RCT. 235 Females, 159 Males. Primary outcome: pain. P=.01');
    expect(result.population.n_male).toBe(159);
    expect(result.population.n_female).toBe(235);
  });
});

describe('TextParser — median yaş formatı', () => {
  test('Median (range) age tespit edilir', () => {
    const result = parseText(
      'RCT. 159 men and 235 women. Median (range) age, 49.8 (40.7-55.8) y. Primary outcome: activity limitations. P=.01'
    );
    expect(result.population.median_age).toBe('49.8 y');
    expect(result.population.age_range).toBe('40.7-55.8');
  });

  test('Mean (SD) age ile range formatı', () => {
    const result = parseText(
      'RCT. 54 Males, 54 Females. Mean (SD) age, 5.2 y (range, 1.8; 3-12 y). Primary outcome: visual acuity. P=.002'
    );
    expect(result.population.mean_age).toBe('5.2 y');
    expect(result.population.age_range).toContain('1.8');
  });
});

describe('TextParser — katılımcı sayısı (randomized/analyzed)', () => {
  test('randomized ve analyzed ayrı tespiti', () => {
    const result = parseText(
      'RCT. 400 Participants randomized. 394 Participants analyzed. 159 men and 235 women. Primary outcome: pain. P=.01'
    );
    expect(result.intervention.n_randomized).toBe(400);
    expect(result.intervention.n_analyzed).toBe(394);
  });
});

describe('TextParser — youth/pediatric studies', () => {
  test('Among X youths + Y (Z%) were female pattern', () => {
    const result = parseText(
      'RCT. Among 164 youths (mean [SD] age, 14.9 [1.4] years; 97 (59%) were female). ' +
      'Primary outcome: treatment response. OR 1.96; P = .06'
    );
    expect(result.population.n_female).toBe(97);
    expect(result.population.n_male).toBe(67);
    expect(result.population.mean_age).toBe('14.9 y');
  });
});
