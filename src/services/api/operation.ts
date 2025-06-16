import ApiError from "@/services/api/api-error";
import {auth} from "@/stores/auth";
import {config} from "@/config";
import axios from "axios";

export async function operation(method, uri, data, headers){
  try {
    await renewAccessToken()
    const headersWithAuth = {...authorizationHeader(), ...headers}
    const response = await makeRequest(method, uri, data, headersWithAuth)
    await checkResponse(response)
    return response
  } catch (e) {
    if (e instanceof ApiError && e.statusCode === 401) {
      await auth.logout()
    } else {
      throw e;
    }
  }s
}

async function checkResponse(res) {
  if (res.status === 401) {
    throw new ApiError(401, "Uživatel není přihlášen.", res);
  } else if (res.status === 403) {
    throw new ApiError(403, "Uživatel nemá dostatečná oprávnění.", res);
  } else if (res.status === 404) {
    throw new ApiError(404, "Cílový objekt neexistuje.", res);
  } else if (res.status === 409) { // Conflict must be handled inside modules
    throw new ApiError(409, null, res);
  } else if (res.status >= 304) { // other errors
    const message = res.method === 'get' ? 'Nepodařilo se načíst data.' : 'Nepodařilo se uložit data.';
    throw new ApiError(res.status, message, res);
  }
}

const authorizationHeader = () => auth.isAuthenticated ? { "Authorization": "Bearer " + auth.token.value } : {}

async function renewAccessToken() {
  if(!auth.isAuthenticated){
    return;
  }
  try {
    await auth.renewToken()
  } catch (e) {
    throw new ApiError(401, 'Could not renew access token', e);
  }
}

async function makeRequest(method, uri, data, headers){
  return await axios.create({
    validateStatus: () => true // Prevent axios from throwing Promise exception, so it can be handled in operation.checkResponse().
  }).request({
    method: method,
    url: config.serverUrl + uri,
    data: data,
    headers: headers
  });
}
