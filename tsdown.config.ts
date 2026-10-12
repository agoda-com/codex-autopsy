import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/cli.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: false,
  clean: true,
  fixedExtension: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
})
