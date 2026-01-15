/**
 * main.ts
 *
 * Bootstraps Vuetify and other plugins then mounts the App`
 */

// Plugins
import { registerPlugins } from '@/plugins'

// Components
import App from './App.vue'

// Composables
import { createApp } from 'vue'
import { auth } from "@/stores/auth";

async function initApp() {
  const app = createApp(App)
  await auth.init()

  registerPlugins(app)

  app.mount('#app')
}

initApp()


