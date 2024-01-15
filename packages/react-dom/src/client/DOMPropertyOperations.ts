export function setValueForProperty(
  node: HTMLElement,
  name: string,
  value: any,
) {
  if (name.startsWith("on")) {
    const eventName = name.toLowerCase().replace("on", "")
    node.removeEventListener(eventName, (node as any)._eventCallback)
    if (value) {
      node.addEventListener(eventName, value)
      ;(node as any)._eventCallback = value
    }
  } else if (value === null) {
    node.removeAttribute(name)
  } else {
    node.setAttribute(name, `${value}`)
  }
}
