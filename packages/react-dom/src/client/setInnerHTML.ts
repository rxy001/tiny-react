/**
 * Set the innerHTML property of a node
 *
 * @param {DOMElement} node
 * @param {string} html
 * @internal
 */
const setInnerHTML = (node: HTMLElement, html: string): void => {
  node.innerHTML = html
}

export default setInnerHTML
