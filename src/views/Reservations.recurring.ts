import { ref, computed } from 'vue'

type RecurrenceKind = 'none' | 'daily' | 'weekly' | 'monthly'
export const isAllDay = ref<boolean>(false)
export const rangeToYmd = ref<string | null>(null) // datum do (pro více dní)
export const recurrenceKind = ref<RecurrenceKind>('none')
export const recurrenceCount = ref<number>(1)

export const isEditorValidExtended = computed(() => {
  // příklad validace: pokud all-day → ignoruj hm kontroly, ale zkontroluj rozsah dnů
  return true
})

// při uložení:
// - pokud isallday -> nastav start= 00:00, end= 23:59
// - pokud rangetoymd -> vytvoř sérii dnů (pokud backend neumí jeden kontinuální interval přes více dní)
// - pokud recurrencekind !== 'none' -> vygeneruj výskyty a pro každý buď patch/post, nebo batch (a kolize řeš přes conflictdialog)
