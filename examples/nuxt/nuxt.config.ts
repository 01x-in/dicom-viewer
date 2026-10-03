// Deliberately minimal: the matrix checks that the viewer needs no Nuxt module or Vite config.
export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
  telemetry: false,
});
