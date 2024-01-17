import ReactSharedInternals from "shared/ReactSharedInternals"

import type { Fiber, Dispatcher } from "./ReactInternalTypes"
import type { Lanes, Lane } from "./ReactFiberLane"

import {
  enqueueConcurrentHookUpdate,
  enqueueConcurrentHookUpdateAndEagerlyBailout,
} from "./ReactFiberConcurrentUpdates"
import { NoLanes, NoLane, isSubsetOfLanes, mergeLanes } from "./ReactFiberLane"
import {
  requestUpdateLane,
  requestEventTime,
  scheduleUpdateOnFiber,
  markSkippedUpdateLanes,
} from "./ReactFiberWorkLoop"

type BasicStateAction<S> = ((state: S) => S) | S
type Dispatch<A> = (action: A) => void

export type Update<S, A> = {
  lane: Lane
  action: A
  hasEagerState: boolean
  eagerState: S | null
  next: Update<S, A>
}

export type Hook = {
  memoizedState: any
  baseState: any
  baseQueue: Update<any, any> | null
  queue: any
  next: Hook | null
}

export type UpdateQueue<S, A> = {
  pending: Update<S, A> | null
  interleaved: Update<S, A> | null
  lanes: Lanes
  dispatch: ((action: A) => unknown) | null
  lastRenderedReducer: ((state: S, action: A) => S) | null
  lastRenderedState: S | null
}

const { ReactCurrentDispatcher } = ReactSharedInternals

const RE_RENDER_LIMIT = 25

// These are set right before calling the component.
let renderLanes: Lanes = NoLanes

// The work-in-progress fiber. I've named it differently to distinguish it from
// the work-in-progress hook.
let currentlyRenderingFiber: Fiber = null as any

// Hooks are stored as a linked list on the fiber's memoizedState field. The
// current hook list is the list that belongs to the current fiber. The
// work-in-progress hook list is a new list that will be added to the
// work-in-progress fiber.
let currentHook: Hook | null = null
let workInProgressHook: Hook | null = null

// Where an update was scheduled only during the current render pass. This
// gets reset after each attempt.
// TODO: Maybe there's some way to consolidate this with
// `didScheduleRenderPhaseUpdate`. Or with `numberOfReRenders`.
let didScheduleRenderPhaseUpdateDuringThisPass: boolean = false

export function renderWithHooks<Props>(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: (p: Props) => any,
  props: Props,
  nextRenderLanes: Lanes,
) {
  renderLanes = nextRenderLanes
  currentlyRenderingFiber = workInProgress

  // Warn if no hooks are used at all during mount, then some are used during update.
  // Currently we will identify the update render as a mount because memoizedState === null.
  // This is tricky because it's valid for certain types of components (e.g. React.lazy)

  // Using memoizedState to differentiate between mount/update only works if at least one stateful hook is used.
  // Non-stateful hooks (e.g. context) don't get added to memoizedState,
  // so memoizedState would be null during updates and mounts.

  // current === null means this is a new mount
  // current.memoziedState === null 主要用于区分 React.lazy 是否挂载
  ReactCurrentDispatcher.current =
    current === null || current.memoizedState === null
      ? HooksDispatcherOnMount
      : HooksDispatcherOnUpdate

  let children = Component(props)

  // Check if there was a render phase update
  if (didScheduleRenderPhaseUpdateDuringThisPass) {
    // Keep rendering in a loop for as long as render phase updates continue to
    // be scheduled. Use a counter to prevent infinite loops.
    let numberOfReRenders: number = 0
    do {
      didScheduleRenderPhaseUpdateDuringThisPass = false

      if (numberOfReRenders >= RE_RENDER_LIMIT) {
        throw new Error(
          "Too many re-renders. React limits the number of renders to prevent " +
            "an infinite loop.",
        )
      }

      numberOfReRenders += 1

      // Start over from the beginning of the list
      currentHook = null
      workInProgressHook = null

      workInProgress.updateQueue = null

      ReactCurrentDispatcher.current = HooksDispatcherOnRerender

      children = Component(props)
    } while (didScheduleRenderPhaseUpdateDuringThisPass)
  }

  // We can assume the previous dispatcher is always this one, since we set it
  // at the beginning of the render phase and there's no re-entrance.
  ReactCurrentDispatcher.current = ContextOnlyDispatcher

  // This check uses currentHook so that it works the same in DEV and prod bundles.
  // hookTypesDev could catch more cases (e.g. context) but only in DEV bundles.
  const didRenderTooFewHooks = currentHook !== null && currentHook.next !== null

  if (didRenderTooFewHooks) {
    throw new Error(
      "Rendered fewer hooks than expected. This may be caused by an accidental " +
        "early return statement.",
    )
  }

  currentHook = null
  workInProgressHook = null
  renderLanes = NoLanes
  currentlyRenderingFiber = null as any

  return children
}

function basicStateReducer<S>(state: S, action: BasicStateAction<S>): S {
  // $FlowFixMe: Flow doesn't like mixed types
  return typeof action === "function" ? (action as any)(state) : action
}

function mountState<S>(
  initialState: S | (() => S),
): [S, Dispatch<BasicStateAction<S>>] {
  const hook = mountWorkInProgressHook()

  if (typeof initialState === "function") {
    initialState = (initialState as any)()
  }

  hook.memoizedState = hook.baseState = initialState

  const queue: UpdateQueue<S, BasicStateAction<S>> = {
    // 本次更新将要处理的 update，环状链表
    pending: null,
    // 插入的 update，环状链表
    interleaved: null,
    // 用于 entangle
    lanes: NoLanes,
    dispatch: null,
    // 只会用于 setState 时计算 newState
    lastRenderedReducer: basicStateReducer,
    // 只会用于 setState 时与 newState 进行比较, 若相等可提前结束避免重渲染
    lastRenderedState: initialState as any,
  }

  hook.queue = queue
  const dispatch: Dispatch<BasicStateAction<S>> = (queue.dispatch = (
    dispatchSetState.bind as any
  )(null, currentlyRenderingFiber, queue))
  return [hook.memoizedState, dispatch]
}

function updateState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  return updateReducer(basicStateReducer, initialState)
}

function rerenderState<S>(
  initialState: (() => S) | S,
): [S, Dispatch<BasicStateAction<S>>] {
  return rerenderReducer(basicStateReducer, initialState as any)
}

function mountReducer<S, I, A>(
  reducer: (state: S, action: A) => S,
  initialArg: I,
  init?: (initial: I) => S,
): [S, Dispatch<A>] {
  const hook = mountWorkInProgressHook()
  let initialState
  if (init !== undefined) {
    initialState = init(initialArg)
  } else {
    initialState = initialArg as any as S
  }
  hook.memoizedState = hook.baseState = initialState
  const queue: UpdateQueue<S, A> = {
    // 本次更新将要处理的 update，环状链表
    pending: null,
    // 插入的 update，环状链表
    interleaved: null,
    // used for entangling transitions
    lanes: NoLanes,
    dispatch: null,
    // 只会用于 setState 时计算 newState
    lastRenderedReducer: reducer,
    // 只会用于 setState 时与 newState 进行比较, 若相等可提前结束避免重渲染
    lastRenderedState: initialState as any,
  }
  hook.queue = queue
  const dispatch: Dispatch<A> = (queue.dispatch = (
    dispatchReducerAction.bind as any
  )(null, currentlyRenderingFiber, queue))
  return [hook.memoizedState, dispatch]
}

function updateReducer<S, I, A>(
  reducer: (state: S, action: A) => S,
  _initialArg: I,
  _init?: (initial: I) => S,
): [S, Dispatch<A>] {
  const hook = updateWorkInProgressHook()
  const { queue } = hook

  if (queue === null) {
    throw new Error(
      "Should have a queue. This is likely a bug in React. Please file an issue.",
    )
  }

  queue.lastRenderedReducer = reducer

  const current: Hook = currentHook as any

  // The last rebase update that is NOT part of the base state.
  let { baseQueue } = current

  // The last pending update that hasn't been processed yet.
  const pendingQueue = queue.pending

  if (pendingQueue !== null) {
    // We have new updates that haven't been processed yet.
    // We'll add them to the base queue.
    if (baseQueue !== null) {
      // Merge the pending queue and the base queue.
      const baseFirst = baseQueue.next
      const pendingFirst = pendingQueue.next
      baseQueue.next = pendingFirst
      pendingQueue.next = baseFirst
    }

    // x-todo: 保存在 current.baseQueue?
    current.baseQueue = baseQueue = pendingQueue
    queue.pending = null
  }

  if (baseQueue !== null) {
    // We have a queue to process.
    const first = baseQueue.next
    let newState = current.baseState

    let newBaseState = null
    let newBaseQueueFirst = null
    let newBaseQueueLast = null
    let update = first

    do {
      const updateLane = update.lane
      if (!isSubsetOfLanes(renderLanes, updateLane)) {
        // Priority is insufficient. Skip this update. If this is the first
        // skipped update, the previous update/state is the new base
        // update/state.
        const clone: Update<S, A> = {
          lane: updateLane,
          action: update.action,
          hasEagerState: update.hasEagerState,
          eagerState: update.eagerState,
          next: null as any,
        }
        if (newBaseQueueLast === null) {
          newBaseQueueFirst = newBaseQueueLast = clone
          newBaseState = newState
        } else {
          newBaseQueueLast = (newBaseQueueLast.next as any) = clone
        }
        // Update the remaining priority in the queue.
        // TODO: Don't need to accumulate this. Instead, we can remove
        // renderLanes from the original lanes.
        currentlyRenderingFiber.lanes = mergeLanes(
          currentlyRenderingFiber.lanes,
          updateLane,
        )
        markSkippedUpdateLanes(updateLane)
      } else {
        // This update does have sufficient priority.

        // state 的最终结果跟 update 的时序相关，而非优先级.
        // 并且 action 可能为函数，依赖前一个的 state 值，因此如果 newBaseQueueLast 不为 null时，需存储后续的所有 update
        if (newBaseQueueLast !== null) {
          const clone: Update<S, A> = {
            // This update is going to be committed so we never want uncommit
            // it. Using NoLane works because 0 is a subset of all bitmasks, so
            // this will never be skipped by the check above.
            lane: NoLane,
            action: update.action,
            hasEagerState: update.hasEagerState,
            eagerState: update.eagerState,
            next: null as any,
          }
          newBaseQueueLast = (newBaseQueueLast.next as any) = clone
        }

        // Process this update.
        if (update.hasEagerState) {
          // If this update is a state update (not a reducer) and was processed eagerly,
          // we can use the eagerly computed state
          newState = update.eagerState as S
        } else {
          const { action } = update
          newState = reducer(newState, action)
        }
      }
      update = update.next
    } while (update !== null && update !== first)

    if (newBaseQueueLast === null) {
      newBaseState = newState
    } else {
      newBaseQueueLast.next = newBaseQueueFirst as any
    }

    hook.memoizedState = newState
    hook.baseState = newBaseState
    hook.baseQueue = newBaseQueueLast

    queue.lastRenderedState = newState
  }

  // Interleaved updates are stored on a separate queue. We aren't going to
  // process them during this render, but we do need to track which lanes
  // are remaining.

  // concurrent render 协调时可能会在让步给浏览器时产生新的 interleaved update
  // 或者是其它组件更新时调用该 hook 的 setState.
  // setState 时会更新 fiber.lanes，但该 fiber beginWork 时会重置 lanes,
  const lastInterleaved = queue.interleaved
  if (lastInterleaved !== null) {
    let interleaved = lastInterleaved
    do {
      const interleavedLane = interleaved.lane
      currentlyRenderingFiber.lanes = mergeLanes(
        currentlyRenderingFiber.lanes,
        interleavedLane,
      )
      markSkippedUpdateLanes(interleavedLane)
      interleaved = (interleaved as any).next as Update<S, A>
    } while (interleaved !== lastInterleaved)
  } else if (baseQueue === null) {
    // `queue.lanes` is used for entangling transitions. We can set it back to
    // zero once the queue is empty.
    queue.lanes = NoLanes
  }

  const dispatch: Dispatch<A> = queue.dispatch as any
  return [hook.memoizedState, dispatch]
}

function rerenderReducer<S, I, A>(
  reducer: (state: S, action: A) => S,
  _initialArg: I,
  _init?: (initial: I) => S,
): [S, Dispatch<A>] {
  const hook = updateWorkInProgressHook()
  const { queue } = hook

  if (queue === null) {
    throw new Error(
      "Should have a queue. This is likely a bug in React. Please file an issue.",
    )
  }

  queue.lastRenderedReducer = reducer

  // This is a re-render. Apply the new render phase updates to the previous
  // work-in-progress hook.
  const dispatch: Dispatch<A> = queue.dispatch as any
  const lastRenderPhaseUpdate = queue.pending
  let newState = hook.memoizedState
  if (lastRenderPhaseUpdate !== null) {
    // The queue doesn't persist past this render pass.
    queue.pending = null

    const firstRenderPhaseUpdate = lastRenderPhaseUpdate.next
    let update = firstRenderPhaseUpdate
    do {
      // Process this render phase update. We don't have to check the
      // priority because it will always be the same as the current
      // render's.
      const { action } = update
      newState = reducer(newState, action)
      update = update.next
    } while (update !== firstRenderPhaseUpdate)

    hook.memoizedState = newState
    // Don't persist the state accumulated from the render phase updates to
    // the base state unless the queue is empty.
    // TODO: Not sure if this is the desired semantics, but it's what we
    // do for gDSFP. I can't remember why.
    if (hook.baseQueue === null) {
      hook.baseState = newState
    }

    queue.lastRenderedState = newState
  }
  return [newState, dispatch]
}

function mountMemo<T>(
  nextCreate: () => T,
  deps: Array<unknown> | void | null,
): T {
  const hook = mountWorkInProgressHook()
  const nextDeps = deps === undefined ? null : deps
  const nextValue = nextCreate()
  hook.memoizedState = [nextValue, nextDeps]
  return nextValue
}

function updateMemo<T>(
  nextCreate: () => T,
  deps: Array<unknown> | void | null,
): T {
  const hook = updateWorkInProgressHook()
  const nextDeps = deps === undefined ? null : deps
  const prevState = hook.memoizedState
  if (prevState !== null) {
    // Assume these are defined. If they're not, areHookInputsEqual will warn.
    if (nextDeps !== null) {
      const prevDeps: Array<unknown> | null = prevState[1]
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        return prevState[0]
      }
    }
  }
  const nextValue = nextCreate()
  hook.memoizedState = [nextValue, nextDeps]
  return nextValue
}

function mountCallback<T>(
  callback: T,
  deps: Array<undefined> | void | null,
): T {
  // 可以使用 mountMemo(() => callback, deps) 平替

  const hook = mountWorkInProgressHook()
  const nextDeps = deps === undefined ? null : deps
  hook.memoizedState = [callback, nextDeps]
  return callback
}

function updateCallback<T>(
  callback: T,
  deps: Array<undefined> | void | null,
): T {
  const hook = updateWorkInProgressHook()
  const nextDeps = deps === undefined ? null : deps
  const prevState = hook.memoizedState
  if (prevState !== null) {
    if (nextDeps !== null) {
      const prevDeps: Array<undefined> | null = prevState[1]
      if (areHookInputsEqual(nextDeps, prevDeps)) {
        return prevState[0]
      }
    }
  }
  hook.memoizedState = [callback, nextDeps]
  return callback
}

// TODO：暂时只能获取 DOM 元素
function mountRef<T>(initialValue: T): { current: T } {
  const hook = mountWorkInProgressHook()

  const ref = { current: initialValue }
  hook.memoizedState = ref
  return ref
}

function updateRef<T>(_initialValue?: T): { current: T } {
  const hook = updateWorkInProgressHook()
  return hook.memoizedState
}

function mountWorkInProgressHook(): Hook {
  const hook: Hook = {
    // 已渲染的 state
    memoizedState: null,
    // 若存在跳过的 update，记录此时的 state，以便处理跳过的 uodate 时计算 state
    baseState: null,
    // 优先级不够跳过的 update，环状链表
    baseQueue: null,
    queue: null,

    next: null,
  }

  if (workInProgressHook === null) {
    // This is the first hook in the list
    currentlyRenderingFiber.memoizedState = workInProgressHook = hook
  } else {
    // Append to the end of the list
    workInProgressHook = workInProgressHook.next = hook
  }
  return workInProgressHook
}

function updateWorkInProgressHook(): Hook {
  // This function is used both for updates and for re-renders triggered by a
  // render phase update. It assumes there is either a current hook we can
  // clone, or a work-in-progress hook from a previous render pass that we can
  // use as a base. When we reach the end of the base list, we must switch to
  // the dispatcher used for mounts.
  let nextCurrentHook: null | Hook
  if (currentHook === null) {
    const current = currentlyRenderingFiber.alternate
    if (current !== null) {
      nextCurrentHook = current.memoizedState
    } else {
      nextCurrentHook = null
    }
  } else {
    nextCurrentHook = currentHook.next
  }

  let nextWorkInProgressHook: null | Hook

  // 每次 renderWithHooks 执行结束以及处理 render 阶段的更新时
  // 都会重置 workInProgressHook
  if (workInProgressHook === null) {
    // renderWithHooks 调用初始阶段重置 memoizedState
    // 因此非 render 阶段的更新时 memoizedState 都为 null
    nextWorkInProgressHook = currentlyRenderingFiber.memoizedState
  } else {
    // 为了构建 hooks 链表
    nextWorkInProgressHook = workInProgressHook.next
  }

  // x-todo: 什么情况下 nextWorkInProgressHook !== null ?
  if (nextWorkInProgressHook !== null) {
    // There's already a work-in-progress. Reuse it.
    workInProgressHook = nextWorkInProgressHook
    nextWorkInProgressHook = workInProgressHook.next

    currentHook = nextCurrentHook
  } else {
    // Clone from the current hook.

    if (nextCurrentHook === null) {
      throw new Error("Rendered more hooks than during the previous render.")
    }

    currentHook = nextCurrentHook

    const newHook: Hook = {
      memoizedState: currentHook.memoizedState,

      baseState: currentHook.baseState,
      baseQueue: currentHook.baseQueue,
      queue: currentHook.queue,

      next: null,
    }

    // newHook.queue === currentHook.queue
    // 因此 dispatchSetState 时，update 会同时添加到 currentlyRenderingFiber 和.alternate
    // 中同一 hook 的 queue 中

    if (workInProgressHook === null) {
      // This is the first hook in the list.
      currentlyRenderingFiber.memoizedState = workInProgressHook = newHook
    } else {
      // Append to the end of the list.
      workInProgressHook = workInProgressHook.next = newHook
    }
  }
  return workInProgressHook
}

function dispatchSetState<S, A>(
  fiber: Fiber,
  queue: UpdateQueue<S, A>,
  action: A,
) {
  // dispatchSetState 只有在函数式组件挂载时，才会绑定 fiber（以下称为 initialFiber）、queue,
  // 因此每次调用 setState 参数 fiber 都是初次绑定的 initialFiber、queue，
  // 而此时渲染到屏幕上的 fiber 可能为 initialFiber 或者 initialFiber.alternate

  const lane = requestUpdateLane(fiber)

  const update: Update<S, A> = {
    lane,
    action,
    hasEagerState: false,
    eagerState: null,
    next: null as any,
  }

  if (isRenderPhaseUpdate(fiber)) {
    // update 插入到 queue.pengding 中
    // 此时该 queue 已经处理过了，将在 renderWithHooks 函数组件执行结束时中重启处理
    enqueueRenderPhaseUpdate(queue, update)
  } else {
    const { alternate } = fiber
    // initialFiber.lanes 只有在 initialFiber 成为 workInProgress 时才会在 beginWork 阶段情况重置
    // x-todo: 什么情况下会同时为 NoLanes
    if (
      fiber.lanes === NoLanes &&
      (alternate === null || alternate.lanes === NoLanes)
    ) {
      // 目前还未做优化，这里不会触发
      // The queue is currently empty, which means we can eagerly compute the
      // next state before entering the render phase. If the new state is the
      // same as the current state, we may be able to bail out entirely.
      const { lastRenderedReducer } = queue
      if (lastRenderedReducer !== null) {
        try {
          const currentState: S = queue.lastRenderedState as any
          const eagerState = lastRenderedReducer(currentState, action)
          // Stash the eagerly computed state, and the reducer used to compute
          // it, on the update object. If the reducer hasn't changed by the
          // time we enter the render phase, then the eager state can be used
          // without calling the reducer again.

          update.hasEagerState = true
          update.eagerState = eagerState

          if (Object.is(eagerState, currentState)) {
            // Fast path. We can bail out without scheduling React to re-render.
            // It's still possible that we'll need to rebase this update later,
            // if the component re-renders for a different reason and by that
            // time the reducer has changed.

            // x-todo useState 的 reducer 不是一直都为 basicReducer?
            // TODO: Do we still need to entangle transitions in this case?
            enqueueConcurrentHookUpdateAndEagerlyBailout(
              fiber,
              queue,
              update,
              lane,
            )
            return
          }
        } catch (error) {
          // Suppress the error. It will throw again in the render phase.
        }
      }
    }

    // update 插入到 queue.interleaved 中
    // x-todo: fiber 是 initialFiber, 那么如何给正确的 fiber (即与当前渲染所对应的)设置 lanes
    // FAQ:7
    const root = enqueueConcurrentHookUpdate(fiber, queue, update, lane)
    if (root !== null) {
      const eventTime = requestEventTime()
      scheduleUpdateOnFiber(root, fiber, lane, eventTime)
    }
  }
}

function dispatchReducerAction<S, A>(
  fiber: Fiber,
  queue: UpdateQueue<S, A>,
  action: A,
) {
  const lane = requestUpdateLane(fiber)

  const update: Update<S, A> = {
    lane,
    action,
    hasEagerState: false,
    eagerState: null,
    next: null as any,
  }

  if (isRenderPhaseUpdate(fiber)) {
    enqueueRenderPhaseUpdate(queue, update)
  } else {
    // 这里没有提前计算 state, 是因为 reducer 在组件渲染时可能会发生变化
    // useState 的 reducer 是不会发生变化的
    const root = enqueueConcurrentHookUpdate(fiber, queue, update, lane)
    if (root !== null) {
      const eventTime = requestEventTime()
      scheduleUpdateOnFiber(root, fiber, lane, eventTime)
    }
  }
}

function isRenderPhaseUpdate(fiber: Fiber) {
  const { alternate } = fiber
  return (
    fiber === currentlyRenderingFiber ||
    (alternate !== null && alternate === currentlyRenderingFiber)
  )
}

function enqueueRenderPhaseUpdate<S, A>(
  queue: UpdateQueue<S, A>,
  update: Update<S, A>,
) {
  // This is a render phase update. Stash it in a lazily-created map of
  // queue -> linked list of updates. After this render pass, we'll restart
  // and apply the stashed updates on top of the work-in-progress hook.
  didScheduleRenderPhaseUpdateDuringThisPass = true
  const { pending } = queue
  if (pending === null) {
    // This is the first update. Create a circular list.
    update.next = update
  } else {
    update.next = pending.next
    pending.next = update
  }
  queue.pending = update
}

function areHookInputsEqual(
  nextDeps: Array<unknown>,
  prevDeps: Array<unknown> | null,
) {
  if (prevDeps === null) {
    return false
  }

  for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
    if (Object.is(nextDeps[i], prevDeps[i])) {
      continue
    }
    return false
  }
  return true
}

const HooksDispatcherOnMount: Dispatcher = {
  useReducer: mountReducer,
  useState: mountState,
  useCallback: mountCallback,
  // useEffect: mountEffect,
  // useLayoutEffect: mountLayoutEffect,
  useMemo: mountMemo,
  useRef: mountRef,
}

const HooksDispatcherOnUpdate: Dispatcher = {
  useReducer: updateReducer,
  useState: updateState,
  useCallback: updateCallback,
  // useEffect: updateEffect,
  // useLayoutEffect: updateLayoutEffect,
  useMemo: updateMemo,
  useRef: updateRef,
}

const HooksDispatcherOnRerender: Dispatcher = {
  useReducer: rerenderReducer,
  useState: rerenderState,
  useCallback: updateCallback,
  // useEffect: updateEffect,
  // useLayoutEffect: updateLayoutEffect,
  useMemo: updateMemo,
  useRef: updateRef,
}

const throwInvalidHookError: any = function throwInvalidHookError() {
  throw new Error(
    "Invalid hook call. Hooks can only be called inside of the body of a function component. This could happen for" +
      " one of the following reasons:\n" +
      "1. You might have mismatching versions of React and the renderer (such as React DOM)\n" +
      "2. You might be breaking the Rules of Hooks\n" +
      "3. You might have more than one copy of React in the same app\n" +
      "See https://reactjs.org/link/invalid-hook-call for tips about how to debug and fix this problem.",
  )
}

export const ContextOnlyDispatcher: Dispatcher = {
  useCallback: throwInvalidHookError,
  // useEffect: throwInvalidHookError,
  // useLayoutEffect: throwInvalidHookError,
  useMemo: throwInvalidHookError,
  useReducer: throwInvalidHookError,
  useRef: throwInvalidHookError,
  useState: throwInvalidHookError,
}
