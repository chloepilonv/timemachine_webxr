import path from "path";
import { injectIWER } from "@iwsdk/vite-plugin-iwer";
import { compileUIKit } from "@iwsdk/vite-plugin-uikitml";
import { defineConfig, type Plugin } from "vite";
import mkcert from "vite-plugin-mkcert";

// Uncomment the import below and add optimizeGLTF() to the plugins array
// when you place GLTF/GLB files in public/gltf/:
// import { optimizeGLTF } from "@iwsdk/vite-plugin-gltf-optimizer";

const threePkg = path.resolve(__dirname, "node_modules/three");

/**
 * Redirect IWSDK's bundled super-three@0.177.0 imports to the project's
 * single Three.js instance, preventing duplicate Three.js modules and the
 * resulting "Can not resolve #include <splatDefines>" shader error.
 */
function deduplicateThree(): Plugin {
  const bundledThreeRe =
    /node_modules\/@iwsdk\/core\/dist\/node_modules\/\.pnpm\/super-three@[\d.]+\/node_modules\/super-three\/(.*)/;

  return {
    name: "deduplicate-three",
    enforce: "pre",
    resolveId(source, importer) {
      if (!importer) return null;

      const resolved = source.startsWith(".")
        ? path.resolve(path.dirname(importer), source)
        : null;
      const target = resolved ?? source;
      const match = target.match(bundledThreeRe);
      if (match) {
        return path.join(threePkg, match[1]);
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [
    deduplicateThree(),
    // mkcert(), // disabled — run `mkcert -install` manually if HTTPS is needed
    injectIWER({
      device: "metaQuest3",
      activation: "localhost",
      verbose: true,
    }),
    compileUIKit({ sourceDir: "ui", outputDir: "public/ui", verbose: true }),
  ],
  resolve: {
    alias: {
      three: threePkg,
    },
    dedupe: ["three"],
  },
  server: { host: "0.0.0.0", port: 8081, open: true },
  build: {
    outDir: "dist",
    sourcemap: process.env.NODE_ENV !== "production",
    target: "esnext",
    rollupOptions: { input: "./index.html" },
  },
  esbuild: { target: "esnext" },
  optimizeDeps: {
    exclude: ["@babylonjs/havok"],
    esbuildOptions: { target: "esnext" },
  },
  publicDir: "public",
  base: "./",
});
