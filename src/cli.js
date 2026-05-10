#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const { generate } = require('./index');
const { readInput, writeOutput } = require('./io');

const program = new Command();

program
  .name('jama-va')
  .description('JAMA Visual Abstract JSON generator')
  .version('0.1.0');

program
  .command('generate')
  .description('Generate JAMA Visual Abstract JSON from study data')
  .requiredOption('-i, --input <path>', 'Input file path (JSON or text)')
  .requiredOption('-o, --output <path>', 'Output JSON file path')
  .option('-b, --blocks <blocks>', 'Comma-separated block names or "all"', 'all')
  .option('-f, --input-format <format>', 'Input format: json or text', 'json')
  .action(async (opts) => {
    try {
      const raw = readInput(opts.input);
      const inputFormat = opts.inputFormat === 'text' ? 'text' : 'json';
      const input = inputFormat === 'json' ? JSON.parse(raw) : raw;
      const blocks = opts.blocks === 'all' ? ['all'] : opts.blocks.split(',').map((s) => s.trim());

      const result = await generate({ input, blocks, inputFormat });
      writeOutput(opts.output, result);
      console.log(`Written: ${opts.output}`);
      process.exit(0);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(err.exitCode || 1);
    }
  });

program
  .command('validate')
  .description('Validate an existing deck JSON against JAMA word limits')
  .requiredOption('-i, --input <path>', 'Deck JSON file path')
  .action((opts) => {
    try {
      const raw = readInput(opts.input);
      const deck = JSON.parse(raw);
      const blocks = deck.blocks || {};
      let anyOver = false;

      for (const [name, block] of Object.entries(blocks)) {
        if (block.word_limit == null) continue;
        const status = block.within_limit ? 'OK' : 'OVER';
        console.log(`${name}: ${block.word_count}/${block.word_limit} [${status}]`);
        if (!block.within_limit) anyOver = true;
      }

      if (!anyOver) {
        console.log('All blocks within JAMA limits.');
        process.exit(0);
      } else {
        process.exit(2);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(err.exitCode || 1);
    }
  });

program.parse();
