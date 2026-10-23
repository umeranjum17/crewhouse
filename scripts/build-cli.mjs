import { build } from 'esbuild';

await build({
  entryPoints: {
    crewd: 'src/main.ts',
    doctor: 'src/doctor.ts',
    tools: 'src/tools.ts',
    'prepare-engine': 'scripts/prepare-engine.mjs',
    config: 'src/config.ts',
  },
  outdir: 'dist',
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node24.16',
  sourcemap: false,
});
