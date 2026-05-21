import { createRouter, createWebHashHistory } from 'vue-router'
import { useGameStore } from '@/stores/game'
import SetupView from '@/views/SetupView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'setup',
      component: SetupView,
    },
    {
      path: '/design',
      name: 'design',
      component: () => import('@/views/DesignView.vue'),
      beforeEnter: () => {
        const gameStore = useGameStore()
        if (gameStore.phase !== 'design') {
          return { name: 'setup' }
        }
      },
    },
    {
      path: '/battle',
      name: 'battle',
      component: () => import('@/views/BattleView.vue'),
      beforeEnter: () => {
        const gameStore = useGameStore()
        console.log('[router] /battle guard phase=', gameStore.phase, 'mode=', gameStore.mode, 'teams=', gameStore.teams.length, 'players=', gameStore.players.length)
        if (gameStore.phase !== 'battle' && gameStore.phase !== 'results') {
          console.log('[router] /battle BLOCKED, redirecting to /')
          return { name: 'setup' }
        }
      },
    },
    {
      path: '/results',
      name: 'results',
      component: () => import('@/views/ResultsView.vue'),
      beforeEnter: () => {
        const gameStore = useGameStore()
        if (gameStore.phase !== 'results') {
          return { name: 'setup' }
        }
      },
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
    },
  ],
})

export default router
