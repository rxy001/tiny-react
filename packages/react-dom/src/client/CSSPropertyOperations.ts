import dangerousStyleValue from "../shared/dangerousStyleValue"

export function setValueForStyles(
  node: HTMLElement,
  styles: CSSStyleDeclaration,
) {
  const { style } = node
  for (let styleName in styles) {
    if (!styles.hasOwnProperty(styleName)) {
      continue
    }
    const isCustomProperty = styleName.indexOf("--") === 0

    const styleValue = dangerousStyleValue(
      styleName,
      styles[styleName],
      isCustomProperty,
    )
    if (styleName === "float") {
      styleName = "cssFloat"
    }
    if (isCustomProperty) {
      style.setProperty(styleName, styleValue)
    } else {
      style[styleName] = styleValue
    }
  }
}
