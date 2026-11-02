import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    base: './',
    plugins: [react()],
    server: {
        host: process.env.CODESPACES === 'true' ? '0.0.0.0' : 'localhost',
        port: 5173,
        strictPort: true,
        proxy: { '/api': 'http://127.0.0.1:4174' }
    }
})
