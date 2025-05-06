// Utilities
import { defineStore } from 'pinia'
import {get, post} from '@/services/api/api-requests'

export const useProjectStore = defineStore('project', ()=>{
  // states
  const allProjects = ref([]);
  const projectId = ref(undefined)
  const selectedProject = ref({
    name: '',
    description: '',
    startDate: null,
    endDate: null,
    users: [],
    color: '',
    boardTemplate: null
  })
  const blankProject = ref({
    name: '',
    description: '',
    startDate: null,
    endDate: null,
    users: [],
    color: '',
    boardTemplate: null
  })

  // getters

  // setters
  function setProjectId(id){
    projectId.value = id
  }

  async function fetchProject(id) {
    try{
      const response = await get(`project/${id}`)
      return response.data.content
    }catch (e) {
      console.error(e)
    }
  }
  function selectProject(project){
    Object.assign(selectedProject.value, project)
  }
  // actions
  async function fetchAllProjects(){
    try {
      const data = await get('project')
      allProjects.value = data.data.items

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
      color: '',
      boardTemplate: null
    }
  }

  async function saveProject(project) {
    try {
      const data = {
        name: project.name,
        description: project.description,
        startDate: project.startDate,
        endDate: project.endDate,
        color: project.color,
        boardTemplate: project.boardTemplate
      }
      const response = await post('project',data)
      return response.data.content.id
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
    saveProject,
    fetchProject,
    selectProject,
    selectedProject
  }
})
