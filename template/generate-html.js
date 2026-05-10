#!/usr/bin/env node
'use strict';

/**
 * JAMA Visual Abstract HTML generator.
 * Kullanım:
 *   node template/generate-html.js --input <file> [--input-format json|text|pdf] --output <html>
 *
 * Örnekler:
 *   node template/generate-html.js --input fixtures/study/valid-study.json --output output/va.html
 *   node template/generate-html.js --input paper.txt --input-format text    --output output/va.html
 *   node template/generate-html.js --input paper.pdf --input-format pdf     --output output/va.html
 */

const fs   = require('fs');
const path = require('path');

const args = process.argv.slice(2);

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

const inputPath   = getArg('--input');
const outputPath  = getArg('--output') || 'output/va.html';
const inputFormat = getArg('--input-format') || 'json';

if (!inputPath) {
  console.error('Usage: node generate-html.js --input <file> [--input-format text] [--output <file>]');
  process.exit(1);
}

// ── Read template ────────────────────────────────────────────────────────
const templatePath = path.join(__dirname, 'jama-va.html');
if (!fs.existsSync(templatePath)) {
  console.error('Template not found: ' + templatePath);
  process.exit(1);
}
const templateHtml = fs.readFileSync(templatePath, 'utf8');

// ── Read input ───────────────────────────────────────────────────────────
const rawBuffer = fs.readFileSync(path.resolve(inputPath));

// PDF format: pdf-parse ile metin çıkar (devDependency)
async function resolveInput() {
  if (inputFormat === 'pdf') {
    let pdfParse;
    try { pdfParse = require('pdf-parse'); }
    catch (e) {
      console.error('pdf-parse bulunamadı. "npm install" çalıştırın.');
      process.exit(1);
    }
    const result = await pdfParse(rawBuffer);
    const { parseText } = require('../src/parser/text-parser');
    return parseText(result.text);
  }
  if (inputFormat === 'text') {
    const { parseText } = require('../src/parser/text-parser');
    return parseText(rawBuffer.toString('utf8'));
  }
  return JSON.parse(rawBuffer.toString('utf8'));
}

// ── Generate blocks via npm package ─────────────────────────────────────
// (generate() async olduğu için inline wrap)
const { generate } = require('../src/index');

async function main() {
  const studyData = await resolveInput();

  if (studyData.review_flags && studyData.review_flags.length > 0) {
    console.warn('⚠  Düşük güven alanlar (review_flags):', studyData.review_flags.join(', '));
  }

  let deck;
  try {
    deck = await generate({ input: studyData, blocks: ['all'], inputFormat: 'json' });
  } catch (err) {
    console.error('Block generation error:', err.message);
    // Hataya rağmen raw data ile devam et
    deck = null;
  }

  // ── Merge deck content back into studyData for rendering ────────────
  // Template renderVisualAbstract() studyData formatını bekliyor;
  // deck varsa block.content'leri override edelim.
  const renderData = Object.assign({}, studyData);

  if (deck && deck.blocks) {
    if (deck.blocks.title)          renderData.title_raw = deck.blocks.title.content || renderData.title_raw;
    if (deck.blocks.population)     renderData._pop_content = deck.blocks.population.content;
    if (deck.blocks.findings)       renderData._findings_content = deck.blocks.findings.content;
    if (deck.blocks.primary_outcome) renderData._po_content = deck.blocks.primary_outcome.content;
    if (deck.blocks.settings)       renderData._settings_content = deck.blocks.settings.content;
  }

  // ── Inject JAMA_DATA into template ──────────────────────────────────
  const dataScript = `\n<script id="jama-injected-data">\nconst JAMA_DATA = ${JSON.stringify(renderData, null, 2)};\n</script>\n`;

  // Inject before closing </body>
  const finalHtml = templateHtml.replace('</body>', dataScript + '</body>');

  // ── Write output ─────────────────────────────────────────────────────
  const outAbs = path.resolve(outputPath);
  const outDir = path.dirname(outAbs);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outAbs, finalHtml, 'utf8');

  console.log('Visual Abstract HTML written: ' + outAbs);
}

main().catch(err => { console.error(err); process.exit(1); });
