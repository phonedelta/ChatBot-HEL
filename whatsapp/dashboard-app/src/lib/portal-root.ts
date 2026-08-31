/** Portal mount inside the zoomed #root (falls back safely). */
export function getAppPortalRoot(): HTMLElement {
  return (
    document.getElementById('app-portal-root')
    || document.getElementById('root')
    || document.body
  )
}
