import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  build: {
    // Telegram Desktop may use an older embedded Chromium/Edge WebView. Keep
    // the Shell parseable there; Godot capability checks happen separately.
    target: 'es2018',
  },
  plugins: [tailwindcss(), react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
});
