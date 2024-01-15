import assertValidProps from "../shared/assertValidProps"
import { registrationNameDependencies } from "../events/EventRegistry"
import { DOCUMENT_NODE } from "../shared/HTMLNodeType"
import { setValueForStyles } from "./CSSPropertyOperations"
import setInnerHTML from "./setInnerHTML"
import setTextContent from "./setTextContent"
import { setValueForProperty } from "./DOMPropertyOperations"

const DANGEROUSLY_SET_INNER_HTML = "dangerouslySetInnerHTML"
const SUPPRESS_CONTENT_EDITABLE_WARNING = "suppressContentEditableWarning"
const SUPPRESS_HYDRATION_WARNING = "suppressHydrationWarning"
const AUTOFOCUS = "autoFocus"
const CHILDREN = "children"
const STYLE = "style"
const HTML = "__html"

type Props = Record<string, any>

// Calculate the diff between the two objects.
export function diffProperties(
  domElement: Element,
  tag: string,
  lastRawProps: Props,
  nextRawProps: Props,
): null | Array<unknown> {
  let updatePayload: null | Array<any> = null

  let lastProps: Record<string, any>
  let nextProps: Record<string, any>
  switch (tag) {
    default:
      lastProps = lastRawProps
      nextProps = nextRawProps

      break
  }

  assertValidProps(tag, nextProps)

  let propKey
  let styleName
  let styleUpdates: Props | null = null
  for (propKey in lastProps) {
    if (
      nextProps.hasOwnProperty(propKey) ||
      !lastProps.hasOwnProperty(propKey) ||
      lastProps[propKey] == null
    ) {
      continue
    }
    if (propKey === STYLE) {
      const lastStyle = lastProps[propKey]
      for (styleName in lastStyle) {
        if (lastStyle.hasOwnProperty(styleName)) {
          if (!styleUpdates) {
            styleUpdates = {}
          }
          styleUpdates[styleName] = ""
        }
      }
    } else if (propKey === DANGEROUSLY_SET_INNER_HTML || propKey === CHILDREN) {
      // Noop. This is handled by the clear text mechanism.
    } else if (
      propKey === SUPPRESS_CONTENT_EDITABLE_WARNING ||
      propKey === SUPPRESS_HYDRATION_WARNING
    ) {
      // Noop
    } else if (propKey === AUTOFOCUS) {
      // Noop. It doesn't work on updates anyway.
    } else if (registrationNameDependencies.hasOwnProperty(propKey)) {
      // This is a special case. If any listener updates we need to ensure
      // that the "current" fiber pointer gets updated so we need a commit
      // to update this element.
      if (!updatePayload) {
        updatePayload = []
      }
    } else {
      // For all other deleted properties we add it to the queue. We use
      // the allowed property list in the commit phase instead.
      ;(updatePayload = updatePayload || []).push(propKey, null)
    }
  }
  for (propKey in nextProps) {
    const nextProp = nextProps[propKey]
    const lastProp = lastProps != null ? lastProps[propKey] : undefined
    if (
      !nextProps.hasOwnProperty(propKey) ||
      nextProp === lastProp ||
      (nextProp == null && lastProp == null)
    ) {
      continue
    }
    if (propKey === STYLE) {
      if (lastProp) {
        // Unset styles on `lastProp` but not on `nextProp`.
        for (styleName in lastProp) {
          if (
            lastProp.hasOwnProperty(styleName) &&
            (!nextProp || !nextProp.hasOwnProperty(styleName))
          ) {
            if (!styleUpdates) {
              styleUpdates = {}
            }
            styleUpdates[styleName] = ""
          }
        }
        // Update styles that changed since `lastProp`.
        for (styleName in nextProp) {
          if (
            nextProp.hasOwnProperty(styleName) &&
            lastProp[styleName] !== nextProp[styleName]
          ) {
            if (!styleUpdates) {
              styleUpdates = {}
            }
            styleUpdates[styleName] = nextProp[styleName]
          }
        }
      } else {
        // Relies on `updateStylesByID` not mutating `styleUpdates`.
        if (!styleUpdates) {
          if (!updatePayload) {
            updatePayload = []
          }
          updatePayload.push(propKey, styleUpdates)
        }
        styleUpdates = nextProp
      }
    } else if (propKey === DANGEROUSLY_SET_INNER_HTML) {
      const nextHtml = nextProp ? nextProp[HTML] : undefined
      const lastHtml = lastProp ? lastProp[HTML] : undefined
      if (nextHtml != null) {
        if (lastHtml !== nextHtml) {
          ;(updatePayload = updatePayload || []).push(propKey, nextHtml)
        }
      } else {
        // TODO: It might be too late to clear this if we have children
        // inserted already.
      }
    } else if (propKey === CHILDREN) {
      if (typeof nextProp === "string" || typeof nextProp === "number") {
        ;(updatePayload = updatePayload || []).push(propKey, `${nextProp}`)
      }
    } else if (
      propKey === SUPPRESS_CONTENT_EDITABLE_WARNING ||
      propKey === SUPPRESS_HYDRATION_WARNING
    ) {
      // Noop
    } else if (registrationNameDependencies.hasOwnProperty(propKey)) {
      if (nextProp != null) {
        if (propKey === "onScroll") {
          /* empty */
        }
      }
      if (!updatePayload && lastProp !== nextProp) {
        // This is a special case. If any listener updates we need to ensure
        // that the "current" props pointer gets updated so we need a commit
        // to update this element.
        updatePayload = []
      }
    } else {
      // For any other property we always add it to the queue and then we
      // filter it out using the allowed property list during the commit.
      ;(updatePayload = updatePayload || []).push(propKey, nextProp)
    }
  }
  if (styleUpdates) {
    ;(updatePayload = updatePayload || []).push(STYLE, styleUpdates)
  }
  return updatePayload
}

export function createElement(
  type: string,
  props: Record<string, any>,
  rootContainerElement: Element | Document | DocumentFragment,
  _parentNamespace?: string,
): Element {
  // We create tags in the namespace of their parent container, except HTML
  // tags get no namespace.
  const ownerDocument: Document =
    getOwnerDocumentFromRootContainer(rootContainerElement)

  const domElement = ownerDocument.createElement(type)

  if (type === "select") {
    const node = domElement as HTMLSelectElement
    if (props.multiple) {
      node.multiple = true
    } else if (props.size) {
      // Setting a size greater than 1 causes a select to behave like `multiple=true`, where
      // it is possible that no option is selected.
      //
      // This is only necessary when a select in "single selection mode".
      node.size = props.size
    }
  }

  // TODO: 先使用 createElement 代替 createElementNS
  return domElement
}

function getOwnerDocumentFromRootContainer(
  rootContainerElement: Element | Document | DocumentFragment,
): Document {
  return rootContainerElement.nodeType === DOCUMENT_NODE
    ? (rootContainerElement as any)
    : rootContainerElement.ownerDocument
}

export function setInitialProperties(
  domElement: HTMLElement,
  tag: string,
  rawProps: Object,
): void {
  let props: Object
  switch (tag) {
    default:
      props = rawProps
  }

  assertValidProps(tag, props)

  setInitialDOMProperties(tag, domElement, props)

  // switch (tag) {
  //   case 'input':
  //     // TODO: Make sure we check if this is still unmounted or do any clean
  //     // up necessary since we never stop tracking anymore.
  //     track((domElement: any));
  //     ReactDOMInputPostMountWrapper(domElement, rawProps, false);
  //     break;
  //   case 'textarea':
  //     // TODO: Make sure we check if this is still unmounted or do any clean
  //     // up necessary since we never stop tracking anymore.
  //     track((domElement: any));
  //     ReactDOMTextareaPostMountWrapper(domElement, rawProps);
  //     break;
  //   case 'option':
  //     ReactDOMOptionPostMountWrapper(domElement, rawProps);
  //     break;
  //   case 'select':
  //     ReactDOMSelectPostMountWrapper(domElement, rawProps);
  //     break;
  //   default:
  //     if (typeof props.onClick === 'function') {
  //       // TODO: This cast may not be sound for SVG, MathML or custom elements.
  //       trapClickOnNonInteractiveElement(((domElement: any): HTMLElement));
  //     }
  //     break;
  // }
}

function setInitialDOMProperties(
  tag: string,
  domElement: HTMLElement,
  nextProps: Record<string, any>,
): void {
  for (const propKey in nextProps) {
    if (!nextProps.hasOwnProperty(propKey)) {
      continue
    }
    const nextProp = nextProps[propKey]
    if (propKey === STYLE) {
      // Relies on `updateStylesByID` not mutating `styleUpdates`.
      setValueForStyles(domElement, nextProp)
    } else if (propKey === DANGEROUSLY_SET_INNER_HTML) {
      const nextHtml = nextProp ? nextProp[HTML] : undefined
      if (nextHtml != null) {
        setInnerHTML(domElement, nextHtml)
      }
    } else if (propKey === CHILDREN) {
      if (typeof nextProp === "string") {
        // Avoid setting initial textContent when the text is empty. In IE11 setting
        // textContent on a <textarea> will cause the placeholder to not
        // show within the <textarea> until it has been focused and blurred again.
        // https://github.com/facebook/react/issues/6731#issuecomment-254874553
        const canSetTextContent = tag !== "textarea" || nextProp !== ""
        if (canSetTextContent) {
          setTextContent(domElement, nextProp)
        }
      } else if (typeof nextProp === "number") {
        setTextContent(domElement, `${nextProp}`)
      }
    } else if (
      propKey === SUPPRESS_CONTENT_EDITABLE_WARNING ||
      propKey === SUPPRESS_HYDRATION_WARNING
    ) {
      // Noop
    } else if (propKey === AUTOFOCUS) {
      // We polyfill it separately on the client during commit.
      // We could have excluded it in the property list instead of
      // adding a special case here, but then it wouldn't be emitted
      // on server rendering (but we *do* want to emit it in SSR).
    } else if (registrationNameDependencies.hasOwnProperty(propKey)) {
      if (nextProp != null) {
        if (propKey === "onScroll") {
          // listenToNonDelegatedEvent('scroll', domElement);
        }
      }
    } else if (nextProp != null) {
      setValueForProperty(domElement, propKey, nextProp)
    }
  }
}

export function createTextNode(text: string): Text {
  return document.createTextNode(text)
}

export function updateProperties(
  domElement: HTMLElement,
  updatePayload: Array<any>,
): void {
  updateDOMProperties(domElement, updatePayload)
}

function updateDOMProperties(
  domElement: HTMLElement,
  updatePayload: Array<any>,
): void {
  // TODO: Handle wasCustomComponentTag
  for (let i = 0; i < updatePayload.length; i += 2) {
    const propKey = updatePayload[i]
    const propValue = updatePayload[i + 1]
    if (propKey === STYLE) {
      setValueForStyles(domElement, propValue)
    } else if (propKey === DANGEROUSLY_SET_INNER_HTML) {
      setInnerHTML(domElement, propValue)
    } else if (propKey === CHILDREN) {
      setTextContent(domElement, propValue)
    } else {
      setValueForProperty(domElement, propKey, propValue)
    }
  }
}
