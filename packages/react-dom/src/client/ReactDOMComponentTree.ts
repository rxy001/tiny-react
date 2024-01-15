import type { Fiber } from "react-reconciler/src/ReactInternalTypes"
import type {
  Container,
  TextInstance,
  Instance,
  Props,
} from "./ReactDOMHostConfig"

const randomKey = Math.random().toString(36).slice(2)
const internalContainerInstanceKey = `__reactContainer$${randomKey}`
const internalInstanceKey = `__reactFiber$${randomKey}`
const internalPropsKey = `__reactProps$${randomKey}`

export function markContainerAsRoot(hostRoot: Fiber, node: Container): void {
  ;(node as any)[internalContainerInstanceKey] = hostRoot
}

export function precacheFiberNode(
  hostInst: Fiber,
  node: Instance | TextInstance,
): void {
  ;(node as any)[internalInstanceKey] = hostInst
}

export function updateFiberProps(
  node: Instance | TextInstance,
  props: Props,
): void {
  ;(node as any)[internalPropsKey] = props
}
