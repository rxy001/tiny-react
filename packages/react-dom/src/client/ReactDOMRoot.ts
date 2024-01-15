import type { ReactNodeList } from "shared/ReactTypes"
import type { FiberRoot } from "react-reconciler/src/ReactInternalTypes"
import { ConcurrentRoot } from "react-reconciler/src/ReactRootTags"
import {
  createContainer,
  updateContainer,
} from "react-reconciler/src/ReactFiberReconciler"
import {
  ELEMENT_NODE,
  DOCUMENT_NODE,
  DOCUMENT_FRAGMENT_NODE,
} from "../shared/HTMLNodeType"
import { markContainerAsRoot } from "./ReactDOMComponentTree"

export type RootType = {
  render(children: ReactNodeList): void
  unmount(): void
  _internalRoot: FiberRoot | null
}

export type DOMRoot = {
  _internalRoot: FiberRoot
}

export function createRoot(
  container: Element | Document | DocumentFragment,
): RootType {
  if (!isValidContainer(container)) {
    throw new Error("createRoot(...): Target container is not a DOM element.")
  }

  const root = createContainer(container, ConcurrentRoot)

  markContainerAsRoot(root.current, container as any)

  return new (ReactDOMRoot as any)(root)
}

function ReactDOMRoot(this: DOMRoot, internalRoot: FiberRoot) {
  this._internalRoot = internalRoot
}

ReactDOMRoot.prototype.render = function render(children: ReactNodeList): void {
  const root = this._internalRoot
  if (root === null) {
    throw new Error("Cannot update an unmounted root.")
  }

  updateContainer(children, root)
}

// ReactDOMRoot.prototype.unmount = function unmount(): void {
//   const root = this._internalRoot
//   if (root !== null) {
//     this._internalRoot = null
//     const container = root.containerInfo
//     flushSync(() => {
//       updateContainer(null, root, null, null)
//     })
//     unmarkContainerAsRoot(container)
//   }
// }

export function isValidContainer(node: any): boolean {
  return !!(
    node &&
    (node.nodeType === ELEMENT_NODE ||
      node.nodeType === DOCUMENT_NODE ||
      node.nodeType === DOCUMENT_FRAGMENT_NODE)
  )
}
