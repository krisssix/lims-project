export const config = {
  serverUrl: import.meta.env.VITE_SERVER_URL,
  authServer: {
    url: import.meta.env.VITE_AUTH_SERVER_URL,
    realm: import.meta.env.VITE_AUTH_REALM
  }
}
