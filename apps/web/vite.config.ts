import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // Lee el .env de la raíz SOLO en el proceso de Node de Vite; nada de esto se empaqueta para el navegador.
  const env = loadEnv(mode, rootDir, '');
  const apiPort = env.PORT || '3000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        // El navegador llama a /api/...; el proxy agrega la API key del lado del servidor (BFF mínimo de desarrollo).
        '/api': {
          target: `http://127.0.0.1:${apiPort}`,
          rewrite: (path) => path.replace(/^\/api/, ''),
          headers: env.OPS_API_KEY ? { 'x-api-key': env.OPS_API_KEY } : {},
        },
      },
    },
    test: { environment: 'jsdom' },
  };
});
