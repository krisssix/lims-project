import { inject } from 'vue';

export function useAuth() {
  const auth = inject('auth');
  if (!auth) throw new Error('Auth není poskytován!');
  return auth;
}
