import type { Dispatcher } from "react-reconciler/src/ReactInternalTypes"

/**
 * Keeps track of the current dispatcher.
 */
const ReactCurrentDispatcher = {
  /**
   * @internal
   * @type {ReactComponent}
   */
  current: null as null | Dispatcher,
}

export default ReactCurrentDispatcher
