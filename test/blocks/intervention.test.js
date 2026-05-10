'use strict';

const { generate } = require('../../src/blocks/intervention');

const VALID_STUDY = {
  intervention: {
    arms: [
      { n: 106, label: 'Epley maneuver', description: 'Epley maneuver once by a physician and 9 times per day by the patient' },
      { n: 108, label: 'Semont-plus maneuver', description: 'Semont-plus maneuver once by a physician and 9 times per day by the patient' },
    ],
  },
};

describe('intervention block — generate()', () => {
  test('geçerli iki kol → within_limit true', () => {
    const result = generate(VALID_STUDY);
    expect(result.block).toBe('intervention');
    expect(result.within_limit).toBe(true);
  });

  test('her kol ≤ 20 kelime', () => {
    const result = generate(VALID_STUDY);
    result.arms.forEach((arm) => {
      expect(arm.word_count).toBeLessThanOrEqual(20);
    });
  });

  test('intervention yoksa missing: true', () => {
    const result = generate({});
    expect(result.missing).toBe(true);
  });

  test('kol limiti aşılırsa INTERVENTION_ARM_OVERLIMIT fırlatır', () => {
    const overlimit = {
      intervention: {
        arms: [
          {
            n: 106,
            label: 'Epley maneuver',
            description:
              'Epley maneuver performed once by a trained physician specialist and then repeated nine times per day independently by the patient at home every morning',
          },
        ],
      },
    };
    expect(() => generate(overlimit)).toThrow('INTERVENTION_ARM_OVERLIMIT');
  });
});
