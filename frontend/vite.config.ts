
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '^/api/(?:projects/[^/]+|notifications)/events$': {
        target: 'http://localhost:8081',
        changeOrigin: false,
      },
      '^/api/tasks/[^/]+/attachments(?:/.*)?$': {
        target: 'http://localhost:8081',
        changeOrigin: false,
      },
      '/api': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
})
