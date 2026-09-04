import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts', './src/generate.ts', './src/cli.ts'],
  format: ['esm', 'cjs'],
  unbundle: true,
  dts: true,
  sourcemap: true,
  clean: true,
  minify: false,
  fixedExtension: false,
  exports: {
    exclude: ['cli'],
    bin: { 'compose-declarations': './src/cli.ts' },
  },
  publint: {
    strict: true,
  },
})
