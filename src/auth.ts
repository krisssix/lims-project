import Keycloak from "keycloak-js";
import {config} from "@/config";

export const userIsLoading = ref(true);
export const isAuthenticated = ref(false);

export function useAuth() {
  const LOCAL_STORAGE_TOKEN_KEY = "auth_token";
  const isInitialized = ref(false);
  const token = ref(null);
  const keycloak = Keycloak({
    url: config.authServer.url,
    realm: config.authServer.realm,
    clientId: "web",
    publicClient: true,
  });

  const init = () => {
    console.trace('ahooj')
    return keycloak
      .init({
        checkLoginIframe: true,
      })
      .then(() => {
        console.log('init keycloak ', isAuthenticated.value)
        isInitialized.value = true;
      });
  };

  keycloak.onAuthSuccess = () => {
    console.log("Auth success", keycloak);
    isAuthenticated.value = true;
    token.value = keycloak.token;
    localStorage.setItem(LOCAL_STORAGE_TOKEN_KEY, keycloak.token);
    userIsLoading.value = false;
    console.log('aaa', userIsLoading.value, isAuthenticated.value)
  };

  keycloak.onAuthLogout = () => {
    isAuthenticated.value = false;
    token.value = null;
    localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
  };

  const login = (redirectUri = window.location.pathname) => {
    const cleanUri = redirectUri.replace(/#.*/, "");
    keycloak.login({ redirectUri: window.location.origin + cleanUri });
  };

  const logout = () => {
    console.log("keycloak:logout");
    localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
    keycloak.logout({ redirectUri: window.location.origin + "/logged-out" });
  };

  const getToken = () => {
    return token.value || localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  };

  const renewToken = () => {
    return new Promise((resolve, reject) => {
      keycloak
        .updateToken(-1)
        .then(() => {
          token.value = keycloak.token;
          localStorage.setItem(LOCAL_STORAGE_TOKEN_KEY, keycloak.token);
          resolve({succ: true, msg: "Token successfully updated."});
        })
        .catch(() => {
          reject({succ: false, msg: "Token wasn't successfully updated."});
        });
    });
  }

  function isLoggedIn() {
    return this.keycloak.authenticated;
  }

  const checkLogin = (callback) => {
    // console.log('checking login', isInitialized.value, isAuthenticated.value)
    // if (isInitialized.value) {
    //   callback(isAuthenticated.value);
    // } else {
    //   init().then(() => {
    //     callback(isAuthenticated.value);
    //   });
    // }
  };

  return {
    keycloak,
    init,
    isInitialized,
    isAuthenticated,
    token,
    login,
    logout,
    getToken,
    renewToken,
    checkLogin,
    isLoggedIn,
    isLoading: userIsLoading,
  };

}

export const authInstance = useAuth()
