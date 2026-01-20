import { defineStore } from "pinia";

import { get } from "@/services/api/api-requests";
import { auth } from "@/stores/auth";

export const useUserStore = defineStore('user', () => {


  async function getAllUsers() {
    try {
      await get('users')
    } catch (e) {
      console.error(e)
    }
  }

  async function getAllUsersExcept(username = auth.getUserInfo().preferredUsername) {
    try {
      const response = await get(`users/getAllExcept/${username}`)
      return response?.data
    } catch (e) {
      console.log(e)
    }
  }

  function getUserInfo() {
    auth.getUserInfo()
  }


  return {
    getAllUsers,
    getUserInfo,
    getAllUsersExcept
  }
})
