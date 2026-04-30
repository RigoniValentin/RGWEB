import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// ── Build performance config ───────────────────────────────────────────
// • Vendor chunking: keeps huge libraries (antd, icons, jspdf) in their
//   own files so the browser caches them across deploys and the initial
//   page only needs to download the small app shell.
// • esbuild minify + drop console/debugger: smaller payload, less JS to
//   parse on the main thread.
// • cssCodeSplit + modulePreload: per-route CSS, automatic preload of
//   chunks needed for the current page.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@services': path.resolve(__dirname, './src/services'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@store': path.resolve(__dirname, './src/store'),
      '@types': path.resolve(__dirname, './src/types'),
    },
  },
  server: {
    port: 5174,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
    warmup: {
      // Pre-transform the routes the user is most likely to open first
      clientFiles: [
        './src/main.tsx',
        './src/App.tsx',
        './src/components/AppLayout.tsx',
        './src/pages/DashboardPage.tsx',
        './src/pages/LoginPage.tsx',
      ],
    },
  },
  esbuild: {
    // Strip console/debugger from production bundles
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    legalComments: 'none',
  },
  build: {
    target: 'es2020',
    cssCodeSplit: true,
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 1000,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        // Keep big third-party libraries in their own long-lived chunks
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-dom') || id.includes('scheduler')) return 'vendor-react';
          if (id.includes('/react/') || id.endsWith('/react') || id.includes('react-router')) return 'vendor-react';
          if (id.includes('@ant-design/icons')) return 'vendor-icons';
          if (id.includes('rc-') || id.includes('antd') || id.includes('@rc-component')) return 'vendor-antd';
          if (id.includes('jspdf') || id.includes('canvg') || id.includes('html2canvas')) return 'vendor-pdf';
          if (id.includes('jsbarcode') || id.includes('qrcode')) return 'vendor-codes';
          if (id.includes('@tanstack')) return 'vendor-query';
          if (id.includes('dayjs')) return 'vendor-dayjs';
          if (id.includes('axios')) return 'vendor-axios';
          if (id.includes('zustand')) return 'vendor-zustand';
          return 'vendor';
        },
      },
    },
  },
});
