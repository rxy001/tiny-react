import type { FunctionComponent, JSXElementConstructor } from "react"
import { REACT_MEMO_TYPE } from "shared/ReactSymbols"

export function memo<Props>(
  type: FunctionComponent<Props>,
  compare?: (oldProps: Props, newProps: Props) => boolean,
) {
  const elementType = {
    $$typeof: REACT_MEMO_TYPE,
    type,
    compare: compare === undefined ? null : compare,
  }

  return elementType as unknown as JSXElementConstructor<Props>
}
