import { defineConfig } from 'vite'

// Multi-page: the game (index.html) and the wiki/guide (wiki.html).
export default defineConfig({
  define: { global: 'globalThis' },
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        wiki: 'wiki.html',
      },
    },
  },
})
