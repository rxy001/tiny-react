import { createRoot as createRootImpl } from "./ReactDOMRoot"
import type { RootType } from "./ReactDOMRoot"

export function createRoot(
  container: Element | Document | DocumentFragment,
): RootType {
  return createRootImpl(container)
}
