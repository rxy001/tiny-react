import type { Lane, Lanes } from "./ReactFiberLane"
import type { Fiber, FiberRoot } from "./ReactInternalTypes"
import { NoLanes } from "./ReactFiberLane"
import { enqueueConcurrentClassUpdate } from "./ReactFiberConcurrentUpdates"

export const UpdateState = 0

export type Update<State> = {
  // TODO: Temporary field. Will remove this by storing a map of
  // transition -> event time on the root.
  eventTime: number
  lane: Lane

  tag: 0 | 1 | 2 | 3
  payload: any
  callback: (() => unknown) | null

  next: Update<State> | null
}

export type SharedQueue<State> = {
  pending: Update<State> | null
  interleaved: Update<State> | null
  lanes: Lanes
}

export type UpdateQueue<State> = {
  baseState: State
  firstBaseUpdate: Update<State> | null
  lastBaseUpdate: Update<State> | null
  shared: SharedQueue<State>
  effects: Array<Update<State>> | null
}

export function initializeUpdateQueue<State>(fiber: Fiber): void {
  const queue: UpdateQueue<State> = {
    baseState: fiber.memoizedState,
    firstBaseUpdate: null,
    lastBaseUpdate: null,
    shared: {
      pending: null,
      interleaved: null,
      lanes: NoLanes,
    },
    effects: null,
  }
  fiber.updateQueue = queue
}

export function createUpdate(eventTime: number, lane: Lane): Update<any> {
  const update: Update<any> = {
    eventTime,
    lane,

    tag: UpdateState,
    payload: null,
    callback: null,

    next: null,
  }
  return update
}

export function enqueueUpdate<State>(
  fiber: Fiber,
  update: Update<State>,
  lane: Lane,
): FiberRoot | null {
  const { updateQueue } = fiber
  if (updateQueue === null) {
    // Only occurs if the fiber has been unmounted.
    return null
  }

  const sharedQueue: SharedQueue<State> = (updateQueue as any).shared

  // TODO: 删除了 render phase 阶段的更新
  return enqueueConcurrentClassUpdate(fiber, sharedQueue, update, lane)
}

export function cloneUpdateQueue<State>(
  current: Fiber,
  workInProgress: Fiber,
): void {
  // Clone the update queue from current. Unless it's already a clone.
  const queue: UpdateQueue<State> = workInProgress.updateQueue as any
  const currentQueue: UpdateQueue<State> = current.updateQueue as any
  if (queue === currentQueue) {
    const clone: UpdateQueue<State> = {
      baseState: currentQueue.baseState,
      firstBaseUpdate: currentQueue.firstBaseUpdate,
      lastBaseUpdate: currentQueue.lastBaseUpdate,
      shared: currentQueue.shared,
      effects: currentQueue.effects,
    }
    workInProgress.updateQueue = clone
  }
}

function getStateFromUpdate<State>(
  workInProgress: Fiber,
  queue: UpdateQueue<State>,
  update: Update<State>,
  prevState: State,
  nextProps: any,
  instance: any,
): any {
  switch (update.tag) {
    case UpdateState: {
      const { payload } = update
      let partialState
      if (typeof payload === "function") {
        // Updater function
        partialState = payload.call(instance, prevState, nextProps)
      } else {
        // Partial state object
        partialState = payload
      }
      if (partialState === null || partialState === undefined) {
        // Null and undefined are treated as no-ops.
        return prevState
      }
      // Merge the partial state and the previous state.
      return { ...prevState, ...partialState }
    }
    default:
  }
  return prevState
}

export function processUpdateQueue<State>(
  workInProgress: Fiber,
  props: any,
  instance: any,
  _renderLanes: Lanes,
): void {
  // This is always non-null on a ClassComponent or HostRoot
  // workInProgress.updateQueue 是浅拷贝的 current.updateQueue
  const queue: UpdateQueue<State> = workInProgress.updateQueue as any

  let pendingQueue = queue.shared.pending
  let firstPendingQueue = null
  if (pendingQueue !== null) {
    queue.shared.pending = null
    firstPendingQueue = pendingQueue.next
    pendingQueue.next = null
  }

  // These values may change as we process the queue.
  if (firstPendingQueue !== null) {
    // Iterate through the list of updates to compute the result.
    let newState = queue.baseState
    let update = firstPendingQueue
    do {
      // Process this update.
      newState = getStateFromUpdate(
        workInProgress,
        queue,
        update,
        newState,
        props,
        instance,
      )
      update = update.next as any
      if (update === null) {
        pendingQueue = queue.shared.pending
        if (pendingQueue === null) {
          break
        } else {
          // An update was scheduled from inside a reducer. Add the new
          // pending updates to the end of the list and keep processing.
          const lastPendingUpdate = pendingQueue
          // Intentionally unsound. Pending updates form a circular list, but we
          // unravel them when transferring them to the base queue.
          const firstPendingUpdate = lastPendingUpdate.next as Update<State>
          lastPendingUpdate.next = null
          update = firstPendingUpdate
          queue.shared.pending = null
        }
      }
    } while (true)

    workInProgress.lanes = NoLanes
    workInProgress.memoizedState = newState
  }
}
