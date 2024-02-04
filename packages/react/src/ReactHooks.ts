import type { Dispatcher } from "react-reconciler/src/ReactInternalTypes"
import ReactCurrentDispatcher from "./ReactCurrentDispatcher"

type BasicStateAction<S> = ((state: S) => S) | S
type Dispatch<A> = (action: A) => void

function resolveDispatcher() {
  const dispatcher = ReactCurrentDispatcher.current

  // Will result in a null access error if accessed outside render phase. We
  // intentionally don't throw our own error because this is in a hot path.
  // Also helps ensure this is inlined.
  return dispatcher as any as Dispatcher
}

export function useState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  const dispatcher = resolveDispatcher()
  return dispatcher.useState(initialState)
}

export function useCallback<T>(
  callback: T,
  deps: Array<unknown> | void | null,
): T {
  const dispatcher = resolveDispatcher()
  return dispatcher.useCallback(callback, deps)
}

export function useMemo<T>(
  create: () => T,
  deps: Array<unknown> | void | null,
): T {
  const dispatcher = resolveDispatcher()
  return dispatcher.useMemo(create, deps)
}

export function useRef<T>(initialValue?: T): { current: T } {
  const dispatcher = resolveDispatcher()
  return dispatcher.useRef(initialValue) as { current: T }
}

export function useEffect(
  create: () => (() => void) | void,
  deps: Array<unknown> | void | null,
): void {
  const dispatcher = resolveDispatcher()
  return dispatcher.useEffect(create, deps)
}

export function useLayoutEffect(
  create: () => (() => void) | void,
  deps: Array<unknown> | void | null,
): void {
  const dispatcher = resolveDispatcher()
  return dispatcher.useLayoutEffect(create, deps)
}
