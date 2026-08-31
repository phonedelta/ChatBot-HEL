let lockCount = 0
let savedOverflow = ''

export function lockBodyScroll() {
  if (typeof document === 'undefined') return () => {}
  if (lockCount === 0) {
    savedOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  lockCount += 1
  return () => {
    lockCount = Math.max(0, lockCount - 1)
    if (lockCount === 0) {
      document.body.style.overflow = savedOverflow
    }
  }
}
