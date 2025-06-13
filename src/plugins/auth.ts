import { reactive } from 'vue';
import {authInstance} from '@/auth';

export default {
  install(app) {
    const auth = authInstance;
    auth.init().then(() => {
      console.log("Keycloak inicializace hotová");
    });
    // app.provide('auth', reactive(auth));
  }
};
