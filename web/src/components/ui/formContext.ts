import { createContext, useContext } from 'react'

/**
 * The form-row context and its hook, kept apart from form.tsx so that file
 * exports only components — react-refresh needs that to hot-reload them.
 */
export interface FormItemContextValue {
  id: string
  descriptionId: string
  messageId: string
  invalid: boolean
}

export const FormItemContext = createContext<FormItemContextValue | null>(null)

export function useFormField(): FormItemContextValue {
  const context = useContext(FormItemContext)
  if (!context) {
    throw new Error('useFormField must be used inside a FormItem')
  }
  return context
}
