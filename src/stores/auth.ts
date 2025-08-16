import Keycloak from "keycloak-js";
import {config} from "@/config";
import {ref} from "vue";

export const userIsLoading = ref(true);
export const isAuthenticated = ref(false);

export function useAuth() {
  const LOCAL_STORAGE_TOKEN_KEY = "auth_token";
  const isInitialized = ref(false);
  const token = ref(null);
  const keycloak = new Keycloak({
    url: config.authServer.url,
    realm: config.authServer.realm,
    clientId: "web",
    publicClient: true,
  });
  const userInfo = reactive({
    preferredUsername: '',
    email: ''
  })

  const init = () => {
    return keycloak
      .init({
        checkLoginIframe: true,
      })
      .then(() => {
        isInitialized.value = true;
      });
  };

  keycloak.onAuthSuccess = () => {
    isAuthenticated.value = true;
    token.value = keycloak.token;
    localStorage.setItem(LOCAL_STORAGE_TOKEN_KEY, keycloak.token);
    userIsLoading.value = false;
  };

  keycloak.onAuthLogout = () => {
    isAuthenticated.value = false;
    token.value = null;
    localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
  };

  const login = async (redirectUri = window.location.pathname) => {
    const cleanUri = redirectUri.replace(/#.*/, "");
    await keycloak.login({redirectUri: window.location.origin + cleanUri});
  };

  const logout = async () => {
    localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
    await keycloak.logout({ redirectUri: window.location.origin + "/loggedOut" });
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

  function parseJwt (token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    return JSON.parse(jsonPayload);
  }

  const getUserInfo = () => {
    if(userInfo.preferredUsername != ''){
      return userInfo
    } else {
      const parsedToken = parseJwt(getToken())
      userInfo.email = parsedToken.email
      userInfo.preferredUsername = parsedToken.preferred_username
      return userInfo
    }
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
    isLoading: userIsLoading,
    getUserInfo
  };

}

export const auth = useAuth()
