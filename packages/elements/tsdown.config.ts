import { defineConfig } from 'tsdown';
import { stylesheet } from './src/tokens.ts';

export default defineConfig({
  entry: ['src/index.ts', 'src/define.ts'],
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  dts: true,
  sourcemap: true,
  publint: true,
  plugins: [
    {
      // The tokens are written once, in src/tokens.ts, and shipped to hosts as a stylesheet too.
      name: 'dv-emit-stylesheet',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'styles.css', source: stylesheet() });
      },
    },
  ],
});
