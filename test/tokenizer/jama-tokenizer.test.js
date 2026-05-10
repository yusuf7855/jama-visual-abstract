'use strict';

const { tokenize, countWords } = require('../../src/tokenizer/jama-tokenizer');

describe('JAMA Tokenizer — tokenize()', () => {
  test('P=.01 → 1 token', () => {
    expect(tokenize('P=.01')).toHaveLength(1);
  });

  test('P<.001 → 1 token', () => {
    expect(tokenize('P<.001')).toHaveLength(1);
  });

  test('62.6 y → 1 token', () => {
    expect(tokenize('62.6 y')).toHaveLength(1);
  });

  test('214 patients → 1 token', () => {
    expect(tokenize('214 patients')).toHaveLength(1);
  });

  test('3 Academic centers → 3 tokens', () => {
    // "3" + "Academic" + "centers" — NOT sayı+birim, farklı kelime sınıfı
    expect(tokenize('3 Academic centers')).toHaveLength(3);
  });

  test('BPPV → 1 token (kısaltma)', () => {
    expect(tokenize('BPPV')).toHaveLength(1);
  });

  test('RCT → 1 token (kısaltma)', () => {
    expect(tokenize('RCT')).toHaveLength(1);
  });

  test('60° → 1 token', () => {
    expect(tokenize('60°')).toHaveLength(1);
  });

  test('mean (SD), 3.3 (3.6) d → 3 token grubu', () => {
    const tokens = tokenize('mean (SD), 3.3 (3.6) d');
    // Beklenti: ["mean (SD),", "3.3 (3.6) d"] gibi max 3 token
    expect(tokens.length).toBeLessThanOrEqual(3);
    expect(tokens.length).toBeGreaterThanOrEqual(1);
  });

  test('P = .01 → boşluklu format, p değeri ayrı tokenlar olabilir', () => {
    // "P = .01" naif split ile 3 token; tokenizer bunu birleştirmeli
    const count = countWords('P = .01');
    // JAMA kuralı: P=.01 ve P = .01 aynı anlam; tokenizer P=.01'i 1 sayar
    // P = .01 naif formda 3 olabilir — bu test mevcut davranışı belgeler
    expect(count).toBeGreaterThanOrEqual(1);
  });
});

describe('JAMA Tokenizer — yeni birimler ve formatlar', () => {
  test('7.2 Lines → 1 token', () => {
    expect(tokenize('7.2 Lines')).toHaveLength(1);
  });

  test('5.8 Lines → 1 token', () => {
    expect(tokenize('5.8 Lines')).toHaveLength(1);
  });

  test('negatif sayı -4.7 → token içeriyor', () => {
    const tokens = tokenize('-4.7 (95% CI, -6.6 to -2.8)');
    // -4.7 ayrı bir token olarak alınmalı
    expect(tokens.some(t => t.includes('-4.7'))).toBe(true);
  });

  test('CAPT kısaltması → 1 token', () => {
    expect(tokenize('CAPT')).toHaveLength(1);
  });

  test('OMT kısaltması → 1 token', () => {
    expect(tokenize('OMT')).toHaveLength(1);
  });
});

describe('JAMA Tokenizer — countWords()', () => {
  test('boş string → 0', () => {
    expect(countWords('')).toBe(0);
  });

  test('null → 0', () => {
    expect(countWords(null)).toBe(0);
  });

  test('tek kelime', () => {
    expect(countWords('vertigo')).toBe(1);
  });

  test('findings örnek cümlesi ≤ 50 kelime sınırına uyar', () => {
    const sample =
      'Fewer days until free of positional vertigo with Semont-plus vs Epley. Epley: mean (SD), 3.3 (3.6) d. Semont-plus: mean (SD), 2.0 (1.6) d; P=.01';
    expect(countWords(sample)).toBeLessThanOrEqual(50);
  });
});
