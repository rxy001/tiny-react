import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // 预构建会因为 React 包 package.json main 字段指向文件不对报错
    // React-DOM 指向 index.js 就能预构建，而 react 不行
    disabled: true,
  },
})
