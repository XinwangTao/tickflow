import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // 并行跑 38 个文件时机器会满负荷，UI 测试的默认 5s 不够用；
    // 这些用例本身不慢，是被其它 worker 抢了 CPU。
    testTimeout: 20000,
    hookTimeout: 20000
  }
})
