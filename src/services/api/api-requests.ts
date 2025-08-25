import { operation } from "@/services/api/operation";
import { HttpMethod } from "@/services/api/http-method";


export async function get(uri, headers) {
  return await operation(HttpMethod.GET, uri, null, headers)
}

export async function post(uri, data, headers) {
  return await operation(HttpMethod.POST, uri, data, headers)
}

export async function put(uri, data, headers) {
  return await operation(HttpMethod.PUT, uri, data, headers)
}

export async function patch(uri, data, headers) {
  return await operation(HttpMethod.PATCH, uri, data, headers)
}

export async function del(uri, headers) {
  return await operation(HttpMethod.DELETE, uri, null, headers)
}
