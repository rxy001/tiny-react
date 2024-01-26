import type { FiberRoot, Fiber } from "react-reconciler/src/ReactInternalTypes"
import { DefaultEventPriority } from "react-reconciler/src/ReactEventPriorities"
import { getEventPriority } from "../events/ReactDOMEventListener"
import {
  diffProperties,
  createElement,
  setInitialProperties,
  createTextNode,
  updateProperties,
} from "./ReactDOMComponent"
import { precacheFiberNode, updateFiberProps } from "./ReactDOMComponentTree"
import { COMMENT_NODE } from "../shared/HTMLNodeType"

export { detachDeletedInstance } from "./ReactDOMComponentTree"

export type Type = string
export type TextInstance = Text
export type Instance = Element
export type UpdatePayload = Array<unknown>

export type Props = {
  autoFocus?: boolean
  children?: unknown
  disabled?: boolean
  hidden?: boolean
  suppressHydrationWarning?: boolean
  dangerouslySetInnerHTML?: unknown
  style?: { display?: string; [key: string | number]: any }
  bottom?: null | number
  left?: null | number
  right?: null | number
  top?: null | number
  [key: string | number]: any
}

export type Container =
  | (Element & { _reactRootContainer?: FiberRoot })
  | (Document & { _reactRootContainer?: FiberRoot })
  | (DocumentFragment & {
      _reactRootContainer?: FiberRoot
    })

export function getCurrentEventPriority(): any {
  const currentEvent = window.event
  if (currentEvent === undefined) {
    return DefaultEventPriority
  }
  return getEventPriority(currentEvent.type as any)
}

export function shouldSetTextContent(type: string, props: Props): boolean {
  return (
    type === "textarea" ||
    type === "noscript" ||
    typeof props.children === "string" ||
    typeof props.children === "number" ||
    (typeof props.dangerouslySetInnerHTML === "object" &&
      props.dangerouslySetInnerHTML !== null &&
      (props.dangerouslySetInnerHTML as any).__html != null)
  )
}

export function prepareUpdate(
  domElement: Instance,
  type: string,
  oldProps: Props,
  newProps: Props,
): null | Array<unknown> {
  return diffProperties(domElement, type, oldProps, newProps)
}

export function createInstance(
  type: string,
  props: Props,
  internalInstanceHandle: Fiber,
): Instance {
  const domElement: Instance = createElement(type, props, document)
  precacheFiberNode(internalInstanceHandle, domElement)
  updateFiberProps(domElement, props)
  return domElement
}

export function appendInitialChild(
  parentInstance: Instance,
  child: Instance | TextInstance,
): void {
  parentInstance.appendChild(child)
}

export function finalizeInitialChildren(
  domElement: Instance,
  type: string,
  props: Props,
): boolean {
  setInitialProperties(domElement as HTMLElement, type, props)
  switch (type) {
    case "button":
    case "input":
    case "select":
    case "textarea":
      return !!props.autoFocus
    case "img":
      return true
    default:
      return false
  }
}

export function createTextInstance(
  text: string,
  internalInstanceHandle: Fiber,
): TextInstance {
  const textNode: TextInstance = createTextNode(text)
  precacheFiberNode(internalInstanceHandle, textNode)
  return textNode
}

export function resetTextContent(domElement: Instance): void {
  domElement.textContent = ""
}

export function commitTextUpdate(
  textInstance: TextInstance,
  oldText: string,
  newText: string,
): void {
  textInstance.nodeValue = newText
}

export function removeChildFromContainer(
  container: Container,
  child: Instance | TextInstance,
): void {
  if (container.nodeType === COMMENT_NODE) {
    ;(container.parentNode as any).removeChild(child)
  } else {
    container.removeChild(child)
  }
}

export function removeChild(
  parentInstance: Instance,
  child: Instance | TextInstance,
): void {
  parentInstance.removeChild(child)
}

export function commitUpdate(
  domElement: Instance,
  updatePayload: Array<unknown>,
  type: string,
  oldProps: Props,
  newProps: Props,
): void {
  // Apply the diff to the DOM node.
  updateProperties(domElement as HTMLElement, updatePayload)
  // Update the props handle so that we know which props are the ones with
  // with current event handlers.
  updateFiberProps(domElement, newProps)
}

export function insertBefore(
  parentInstance: Instance,
  child: Instance | TextInstance,
  beforeChild: Instance | TextInstance,
): void {
  parentInstance.insertBefore(child, beforeChild)
}

export function appendChild(
  parentInstance: Instance,
  child: Instance | TextInstance,
): void {
  parentInstance.appendChild(child)
}

export function insertInContainerBefore(
  container: Container,
  child: Instance | TextInstance,
  beforeChild: Instance | TextInstance,
): void {
  if (container.nodeType === COMMENT_NODE) {
    ;(container.parentNode as any).insertBefore(child, beforeChild)
  } else {
    container.insertBefore(child, beforeChild)
  }
}

export function appendChildToContainer(
  container: Container,
  child: Instance | TextInstance,
): void {
  let parentNode
  if (container.nodeType === COMMENT_NODE) {
    parentNode = container.parentNode as any
    parentNode.insertBefore(child, container)
  } else {
    parentNode = container
    parentNode.appendChild(child)
  }
}

export const scheduleMicrotask = queueMicrotask
