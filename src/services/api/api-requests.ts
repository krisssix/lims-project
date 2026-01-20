import { operation } from "@/services/api/operation";
import { HttpMethod } from "@/services/api/http-method";

type RequestHeaders = Record<string, string>

export async function get(uri: string, headers?: RequestHeaders) {
  return await operation(HttpMethod.GET, uri, null, headers)
}

export async function post(uri: string, data: unknown, headers?: RequestHeaders) {
  return await operation(HttpMethod.POST, uri, data, headers)
}

export async function put(uri: string, data: unknown, headers?: RequestHeaders) {
  return await operation(HttpMethod.PUT, uri, data, headers)
}

export async function patch(uri: string, data: unknown, headers?: RequestHeaders) {
  return await operation(HttpMethod.PATCH, uri, data, headers)
}

export async function del(uri: string, headers?: RequestHeaders) {
  return await operation(HttpMethod.DELETE, uri, null, headers)
}

export async function delWithBody(uri: string, data: unknown, headers?: RequestHeaders) {
  return await operation(HttpMethod.DELETE, uri, data, headers)
}
