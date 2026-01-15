import { operation } from "@/services/api/operation";
import { HttpMethod } from "@/services/api/http-method";


export async function get<T = any>(uri: string, headers?: any) {
  return await operation(HttpMethod.GET, uri, null, headers)
}

export async function post<T = any>(uri: string, data: any, headers?: any) {
  return await operation(HttpMethod.POST, uri, data, headers)
}

export async function put<T = any>(uri: string, data: any, headers?: any) {
  return await operation(HttpMethod.PUT, uri, data, headers)
}

export async function patch<T = any>(uri: string, data: any, headers?: any) {
  return await operation(HttpMethod.PATCH, uri, data, headers)
}

export async function del<T = any>(uri: string, headers?: any) {
  return await operation(HttpMethod.DELETE, uri, null, headers)
}

export async function delWithBody<T = any>(uri: string, data: any, headers?: any) {
  return await operation(HttpMethod.DELETE, uri, data, headers)
}
