import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// En desarrollo, Vite redirige /api y /socket.io al backend (puerto 4000)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
