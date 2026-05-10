const esbuild = require('esbuild');
const args = process.argv.slice(2);
const watch = args.includes('--watch');

const shared = {
  entryPoints: ['src/index.js'],
  bundle: true,
  sourcemap: true,
};

async function build() {
  // CJS build (Node.js)
  await esbuild.build({
    ...shared,
    platform: 'node',
    format: 'cjs',
    outfile: 'dist/index.cjs.js',
  });

  // ESM build (bundler + modern Node)
  await esbuild.build({
    ...shared,
    platform: 'node',
    format: 'esm',
    mainFields: ['module', 'main'],
    outfile: 'dist/index.esm.js',
  });

  // Browser ESM build (bundler-facing)
  await esbuild.build({
    ...shared,
    platform: 'browser',
    format: 'esm',
    minify: true,
    outfile: 'dist/index.browser.js',
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  // Browser IIFE build — window.JamaVA; works from file:// without CORS
  await esbuild.build({
    ...shared,
    platform: 'browser',
    format: 'iife',
    globalName: 'JamaVA',
    minify: true,
    outfile: 'dist/index.iife.js',
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  console.log('Build complete: dist/index.{cjs,esm,browser,iife}.js');
}

if (watch) {
  const ctx_cjs = esbuild.context({ ...shared, platform: 'node', format: 'cjs', outfile: 'dist/index.cjs.js' });
  const ctx_esm = esbuild.context({ ...shared, platform: 'node', format: 'esm', mainFields: ['module', 'main'], outfile: 'dist/index.esm.js' });
  const ctx_browser = esbuild.context({
    ...shared,
    platform: 'browser',
    format: 'esm',
    minify: true,
    outfile: 'dist/index.browser.js',
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  Promise.all([ctx_cjs, ctx_esm, ctx_browser]).then(async ([cjs, esm, browser]) => {
    await Promise.all([cjs.watch(), esm.watch(), browser.watch()]);
    console.log('Watching for changes...');
  });
} else {
  build().catch(() => process.exit(1));
}
