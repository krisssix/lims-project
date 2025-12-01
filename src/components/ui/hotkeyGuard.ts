
export function isEditableElement(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea') return true
  if (el.isContentEditable) return true
  // Vuetify inputy mají wrapper .v-field__input
  if (el.closest('.v-field__input')) return true
  return false
}
