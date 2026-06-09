import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    // Proxy de desenvolvimento: redireciona chamadas de API para o backend local (vercel dev na porta 3000)
    // Em produção no Vercel, o vercel.json cuida dos rewrites automaticamente.
    proxy: {
      "/auth": { target: "http://localhost:3000", changeOrigin: true },
      "/chatbot": { target: "http://localhost:3000", changeOrigin: true },
      "/integrations": { target: "http://localhost:3000", changeOrigin: true },
      "/sync-rules": { target: "http://localhost:3000", changeOrigin: true },
      "/notifications": { target: "http://localhost:3000", changeOrigin: true },
      "/users": { target: "http://localhost:3000", changeOrigin: true },
      "/webhooks": { target: "http://localhost:3000", changeOrigin: true },
      "/webhook": { target: "http://localhost:3000", changeOrigin: true },
      "/register-webhook": { target: "http://localhost:3000", changeOrigin: true },
      "/test-suri": { target: "http://localhost:3000", changeOrigin: true },
      "/test-ecommerce": { target: "http://localhost:3000", changeOrigin: true },
      "/platform-settings": { target: "http://localhost:3000", changeOrigin: true },
      "/setup": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react":  ["react", "react-dom", "react-router-dom"],
          "vendor-gsap":   ["gsap"],
          "vendor-radix":  [
            "@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu",
            "@radix-ui/react-select", "@radix-ui/react-tooltip",
            "@radix-ui/react-switch", "@radix-ui/react-tabs",
            "@radix-ui/react-label",  "@radix-ui/react-separator",
            "@radix-ui/react-scroll-area", "@radix-ui/react-popover",
            "@radix-ui/react-avatar", "@radix-ui/react-collapsible", "@radix-ui/react-slot"
          ],
          "vendor-utils":  ["clsx", "class-variance-authority", "tailwind-merge", "date-fns", "zustand"],
          "vendor-icons":  ["lucide-react"],
          "vendor-sonner": ["sonner"],
        },
      },
    },
  },
}));
