'use strict';

// fs/path izolasyon katmanı.
// Node.js API YALNIZCA bu dosyada kullanılır.

const fs = require('fs');
const path = require('path');

function readInput(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    const err = new Error(`File not found: ${abs}`);
    err.code = 'FILE_NOT_FOUND';
    err.exitCode = 1;
    throw err;
  }
  return fs.readFileSync(abs, 'utf8');
}

function writeOutput(filePath, data) {
  const abs = path.resolve(filePath);
  const dir = path.dirname(abs);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(abs, JSON.stringify(data, null, 2), 'utf8');
}

module.exports = { readInput, writeOutput };
