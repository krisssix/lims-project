
export function isEditableElement(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea') return true
  if (el.isContentEditable) return true
  // Vuetify inputy mají wrapper .v-field__input nebo .v-text-field
  if (el.closest('.v-field__input')) return true
  if (el.closest('.v-text-field')) return true
  if (el.closest('.v-textarea')) return true
  if (el.closest('.v-select')) return true
  if (el.closest('.v-autocomplete')) return true
  return false
}
