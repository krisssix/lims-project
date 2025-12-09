import { ref, computed } from 'vue'

type RecurrenceKind = 'none' | 'daily' | 'weekly' | 'monthly'
export const isAllDay = ref<boolean>(false)
export const rangeToYmd = ref<string | null>(null) // datum do (pro více dní)
export const recurrenceKind = ref<RecurrenceKind>('none')
export const recurrenceCount = ref<number>(1)

export const isEditorValidExtended = computed(() => {
  // Příklad validace: pokud all-day → ignoruj HM kontroly, ale zkontroluj rozsah dnů
  return true
})

// Při uložení:
// - pokud isAllDay → nastav start= 00:00, end= 23:59
// - pokud rangeToYmd → vytvoř sérii dnů (pokud backend neumí jeden kontinuální interval přes více dní)
// - pokud recurrenceKind !== 'none' → vygeneruj výskyty a pro každý buď PATCH/POST, nebo batch (a kolize řeš přes ConflictDialog)
