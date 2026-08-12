import { defineConfig } from 'vite';

const backend = 'http://localhost:8000';

export default defineConfig({
  server: {
    proxy: {
      '/datasets': backend,
      '/batters': backend,
      '/overview': backend,
      '/zone': backend,
      '/rates': backend,
      '/pitches': backend,
      '/trajectories': backend,
    },
  },
});
