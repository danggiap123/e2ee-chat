import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // Mọi request đến /api/* sẽ được Vite forward sang backend:3000
      // Browser chỉ thấy localhost:5173 → không có cross-origin → không cần CORS
      '/api': {
        target: 'http://localhost:3000',
        rewrite: path => path.replace(/^\/api/, ''),
      },
      // WebSocket cũng proxy qua /ws
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
})
