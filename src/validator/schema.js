'use strict';

// ajv ile JSON schema validasyonu.
// Node.js API kullanılmaz — browser uyumlu.

const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true });

const inputSchema = {
  type: 'object',
  required: ['study_type'],
  properties: {
    study_type: { type: 'string', enum: ['RCT', 'cohort', 'case-control', 'cross-sectional', 'meta-analysis', 'other'] },
    title_raw: { type: 'string' },
    journal: { type: 'string' },
    population: {
      type: 'object',
      properties: {
        n_male: { type: 'number' },
        n_female: { type: 'number' },
        description: { type: 'string' },
        mean_age: { type: 'string' },
        median_age: { type: 'string' },
        age_range: { type: 'string' },
      },
    },
    intervention: {
      type: 'object',
      properties: {
        n_randomized: { type: 'number' },
        n_analyzed: { type: 'number' },
        total_n: { type: 'number' },
        arms: {
          type: 'array',
          items: {
            type: 'object',
            required: ['label', 'description'],
            properties: {
              n: { type: 'number' },
              label: { type: 'string' },
              description: { type: 'string' },
            },
          },
        },
      },
    },
    settings: {
      type: 'object',
      properties: {
        description: { type: 'string' },
      },
    },
    primary_outcome: {
      type: 'object',
      required: ['description'],
      properties: {
        description: { type: 'string' },
      },
    },
    findings: {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        results: { type: 'array' },
        p_value: { type: 'string' },
      },
    },
    citation: {
      type: 'object',
      properties: {
        authors: { type: 'string' },
        title: { type: 'string' },
        journal: { type: 'string' },
        published: { type: 'string' },
        doi: { type: 'string' },
      },
    },
  },
  additionalProperties: true,
};

const validate = ajv.compile(inputSchema);

/**
 * Girdi verisini schema'ya göre doğrular.
 * @param {Object} data
 * @returns {string|null}  — hata mesajı veya null (geçerli)
 */
function validateInput(data) {
  const valid = validate(data);
  if (!valid) {
    const first = validate.errors[0];
    return `${first.instancePath} ${first.message}`.trim();
  }
  return null;
}

module.exports = { validateInput };
