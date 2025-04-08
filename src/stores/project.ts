// Utilities
import { defineStore } from 'pinia'
import {get, post} from '@/services/api/api-requests'

export const useProjectStore = defineStore('project', ()=>{
  // states
  const allProjects = ref([]);
  const projectId = ref(undefined)
  const blankProject = ref({
    name: '',
    description: '',
    startDate: null,
    endDate: null,
    users: [],
    color: ''
  })

  // getters

  // setters
  function setProjectId(id){
    projectId.value = id
  }

  // actions
  async function fetchAllProjects(){
    try {
      const data = await get('project')
      allProjects.value = data.data.items
      console.log('all projects ',data.data.items)
    } catch (e) {
      console.error(e)
    }
  }

  function clearProject(){
    blankProject.value = {
      name: '',
      description: '',
      startDate: null,
      endDate: null,
      users: [],
      color: ''
    }
  }

  async function saveProject(project) {
    try {
      const data = {
        name: project.name,
        description: project.description,
        startDate: project.startDate,
        endDate: project.endDate,
        color: project.color
      }
      const response = await post('project',data)
      console.log('saved, response ', response.data.content)
    } catch (e) {
      console.error(e)
    }
  }

  return {
    allProjects,
    fetchAllProjects,
    projectId,
    setProjectId,
    blankProject,
    clearProject,
    saveProject
  }
})
