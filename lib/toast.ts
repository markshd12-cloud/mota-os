import { toast } from "sonner"

interface ActionOption {
  label:   string
  onClick: () => void
}

export function showSuccess(message: string, action?: ActionOption) {
  toast.success(message, {
    duration: 3000,
    action:   action ? { label: action.label, onClick: action.onClick } : undefined,
  })
}

export function showError(message: string) {
  toast.error(message, { duration: 5000 })
}

export function showInfo(message: string) {
  toast.info(message, { duration: 4000 })
}

export function showWarning(message: string) {
  toast.warning(message, { duration: 4000 })
}

export function showLoading(message: string) {
  return toast.loading(message)
}

export function dismissToast(id: string | number) {
  toast.dismiss(id)
}
