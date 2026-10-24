import { defineConfig } from 'vitest/config'

// The POC test imports the DM app's D&D Beyond mapper directly. The app's
// tsconfig extends Nuxt's generated one, so don't let the transform look it up.
export default defineConfig({
  oxc: { tsconfig: false },
})
