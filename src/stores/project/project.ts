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

  const blankProjectMembers = reactive({
    project: {
      name: '',
      description: '',
      startDate: null,
      endDate: null,
      color: 'deep-orange-darken-3',
      boardTemplate: null
    },
    members: []
  })

  const isProjectFormValid = ref(false)

  const projectMembers = ref([])

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
  async function fetchAllProjects(username = null){
    try {
      const isMe = username === null ? 'true' : 'false'
      let url = `project?isMe=${isMe}`
      if (username !== null) {
        url += `&username=${encodeURIComponent(username)}`
      }
      const data = await get(url)
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

  async function saveProject(projectMember, userInfo) {
    try {
      const data = {
        projectRequest: projectMember.project,
        members: [
          {
            username: userInfo.preferredUsername,
            color: 'black',
            salary: 300,
          },
          ...projectMember.members
        ]
      }
      const response = await post('projectMember', data)
      return response.data.content

    } catch (e) {
      console.error(e)
    }
  }

  function clearProjectMember(){
    blankProjectMembers.members = []
    blankProjectMembers.project = {
      name: '',
      description: '',
      startDate: null,
      endDate: null,
      color: '',
      boardTemplate: null
    }
  }

  async function fetchProjectMembers(projectId){
    try {
      const response = await get('projectMember/' + projectId)
      projectMembers.value = [...response.data.content.members]
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
    selectedProject,
    blankProjectMembers,
    clearProjectMember,
    fetchProjectMembers,
    projectMembers,
    isProjectFormValid
  }
})
