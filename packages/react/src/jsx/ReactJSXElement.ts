import { REACT_ELEMENT_TYPE } from "shared/ReactSymbols"

const { hasOwnProperty } = Object.prototype

type Props = Record<string, any>

type Ref = {
  current: HTMLElement | null
}

const RESERVED_PROPS = {
  key: true,
  ref: true,
  __self: true,
  __source: true,
}

function ReactElement(type: any, key: string | null, ref: Ref, props: Props) {
  const element = {
    // This tag allows us to uniquely identify this as a React Element
    $$typeof: REACT_ELEMENT_TYPE,

    // Built-in properties that belong on the element
    type,
    key,
    ref,
    props,
  }

  return element
}

export function jsx(type: any, config: Props, maybeKey?: string) {
  let propName

  // Reserved names are extracted
  const props: Props = {}

  let key = null
  let ref = null

  // Currently, key can be spread in as a prop. This causes a potential
  // issue if key is also explicitly declared (ie. <div {...props} key="Hi" />
  // or <div key="Hi" {...props} /> ). We want to deprecate key spread,
  // but as an intermediary step, we will use jsxDEV for everything except
  // <div {...props} key="Hi" />, because we aren't currently able to tell if
  // key is explicitly declared to be undefined or not.
  if (maybeKey !== undefined) {
    key = `${maybeKey}`
  }

  if (hasValidKey(config)) {
    key = `${config.key}`
  }

  if (hasValidRef(config)) {
    ref = config.ref
  }

  // Remaining properties are added to a new props object
  for (propName in config) {
    if (
      hasOwnProperty.call(config, propName) &&
      !RESERVED_PROPS.hasOwnProperty(propName)
    ) {
      props[propName] = config[propName]
    }
  }

  // Resolve default props
  if (type && type.defaultProps) {
    const { defaultProps } = type
    for (propName in defaultProps) {
      if (props[propName] === undefined) {
        props[propName] = defaultProps[propName]
      }
    }
  }

  return ReactElement(type, key, ref, props)
}

function hasValidKey(config: Props) {
  return config.key !== undefined
}

function hasValidRef(config: Props) {
  return config.ref !== undefined
}
