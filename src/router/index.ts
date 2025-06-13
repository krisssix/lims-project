/**
 * router/index.ts
 *
 * Automatic routes for `./src/pages/*.vue`
 */

// Composables
import { createRouter, createWebHistory } from 'vue-router/auto'
import { setupLayouts } from 'virtual:generated-layouts'
import Project from "@/pages/Project.vue";
import ProjectDetail from "@/pages/ProjectDetail.vue";
import Board from "@/pages/Board.vue";
import PeopleWork from "@/pages/PeopleWork.vue";
import Summary from "@/pages/Summary.vue";
import Measurements from "@/pages/Measurements.vue";
// import { useAuth} from "@/composables/useAuth";
import AuthSection from "@/AuthSection.vue";
import Index from "@/pages/index.vue";
import {isAuthenticated} from "@/auth";


const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: setupLayouts([
    {
      path: '/',
      component: Index,
    },
    {
      path: '/auth',
      component: AuthSection,
      beforeEnter: requireAuth,
      meta: {
        layout: 'DefaultLayout'
      },
      children: [
        {
          path: 'projects',
          name: 'Projects',
          component: Project,
          meta: {
            layout: 'TopBarLayout'
          }
        },
        {
          path: 'projects/detail/:id',
          name: 'ProjectDetail',
          component: ProjectDetail,
          meta: {
            layout: 'DefaultLayout'
          }
        },
        {
          path: 'project/board/:projectId',
          name: 'Board',
          component: Board,
          meta: {
            layout: 'SimpleSideNavigationLayout'
          }
        },
        {
          path: 'project/peopleWork/:projectId',
          name: 'PeopleWork',
          component: PeopleWork,
          meta: {
            layout: 'SideNavigationLayout'
          }
        },
        {
          path: 'project/summary/:projectId',
          name: 'Summary',
          component: Summary,
          meta: {
            layout: 'SideNavigationLayout'
          }
        },
        {
          path: 'project/measurements/:projectId',
          name: 'Measurements',
          component: Measurements,
          meta: {
            layout: 'SideNavigationLayout'
          }
        },
      ]
    },
  ]),
})

// Workaround for https://github.com/vitejs/vite/issues/11804
router.onError((err, to) => {
  if (err?.message?.includes?.('Failed to fetch dynamically imported module')) {
    if (!localStorage.getItem('vuetify:dynamic-reload')) {
      console.log('Reloading page to fix dynamic import error')
      localStorage.setItem('vuetify:dynamic-reload', 'true')
      location.assign(to.fullPath)
    } else {
      console.error('Dynamic import error, reloading page did not fix it', err)
    }
  } else {
    console.error(err)
  }
})

router.isReady().then(() => {
  localStorage.removeItem('vuetify:dynamic-reload')
})

async function requireAuth(to, from, next) {
   console.log('before guard')

  console.log('isAuthenticated ', isAuthenticated.value)

    if (isAuthenticated) {
      next();
    } else {
      auth.login(to.fullPath)
      next(false);
    }
}

export default router
