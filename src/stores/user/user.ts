import {defineStore} from "pinia";
import {ref} from "vue";

export const useUserStore = defineStore('user', ()=> {
  const isLoggedIn = ref(false)
  const username = ref(null)


  return {
  }
})
