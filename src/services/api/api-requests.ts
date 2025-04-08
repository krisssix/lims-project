import axios from "axios";
import {config} from "@/config";

export async function get(uri, headers) {
  console.log(' server url ',config.serverUrl)
  return await axios.get(config.serverUrl+uri, {headers: headers});
}

export async function post(uri, data, headers) {
  return await axios.post(config.serverUrl+uri, data,{headers: headers})
}

export async function put(uri, data, headers) {
  return await axios.put(config.serverUrl+uri, data,{headers: headers})
}

export async function del(uri, headers) {
  return await axios.delete(config.serverUrl+uri, {headers: headers});
}
