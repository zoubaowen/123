import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  noExternal: ['@ai-xiaobao/shared'],
  splitting: false,
  clean: false,
  loader: {
    '.sql': 'text',
  },
})
