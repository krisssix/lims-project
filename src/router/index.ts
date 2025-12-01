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
import AuthSection from "@/pages/AuthSection.vue";
import {auth, isAuthenticated} from "@/stores/auth";
import LoggedOut from "@/pages/LoggedOut.vue";
import NotFound from "@/pages/NotFound.vue";
import Reservations from "@/pages/Reservations.vue";
import Devices from "@/pages/Devices.vue" // NEW

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: setupLayouts([
    {
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      component: NotFound,
    },
    {
      path: '/',
      redirect: 'auth/projects',
    },
    {
      path: '/loggedOut',
      name: 'LoggedOut',
      component: LoggedOut
    },
    {
      path: '/auth',
      component: AuthSection,
      beforeEnter: requireAuth,
      children: [
        {
          path: 'projects',
          name: 'Projects',
          component: Project,
          beforeEnter: requireAuth,
          meta: {
            layout: 'TopBarLayout'
          }
        },
        {
          path: 'projects/detail/:id',
          name: 'ProjectDetail',
          component: ProjectDetail,
          beforeEnter: requireAuth,
          meta: {
            layout: 'DefaultLayout'
          }
        },
        {
          path: 'project/board/:projectId',
          name: 'Board',
          component: Board,
          beforeEnter: requireAuth,
          meta: {
            layout: 'SimpleSideNavigationLayout'
          }
        },
        {
          path: 'project/peopleWork/:projectId',
          name: 'PeopleWork',
          component: PeopleWork,
          beforeEnter: requireAuth,
          meta: {
            layout: 'SideNavigationLayout'
          }
        },
        {
          path: 'project/summary/:projectId',
          name: 'Summary',
          beforeEnter: requireAuth,
          component: Summary,
          meta: {
            layout: 'SideNavigationLayout'
          }
        },
        {
          path: 'project/measurements/:projectId',
          name: 'Measurements',
          beforeEnter: requireAuth,
          component: Measurements,
          meta: {
            layout: 'SideNavigationLayout'
          }
        },
        {
          path: 'project/reservations/:projectId',
          name: 'Reservations',
          beforeEnter: requireAuth,
          component: Reservations,
          meta: {
            layout: 'SideNavigationLayout'
          }
        },
        {
          path: 'project/devices/:projectId',
          name: 'Devices',
          beforeEnter: requireAuth,
          component: Devices,
          meta: {
            layout: 'SideNavigationLayout'
          }
        }
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

async function requireAuth(to: unknown, from: unknown, next: (v?: boolean) => void) {
  if (isAuthenticated.value) {
    next();
  } else {
    await auth.login((to as { fullPath?: string })?.fullPath || '/')
    next(false)
  }
}

export default router
