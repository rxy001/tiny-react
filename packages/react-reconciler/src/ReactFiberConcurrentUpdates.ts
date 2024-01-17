import type { Fiber, FiberRoot } from "./ReactInternalTypes"
import type { Lane } from "./ReactFiberLane"
import type {
  SharedQueue as ClassQueue,
  Update as ClassUpdate,
} from "./ReactFiberClassUpdateQueue"
import { mergeLanes } from "./ReactFiberLane"
import { HostRoot } from "./ReactWorkTags"
import type {
  UpdateQueue as HookQueue,
  Update as HookUpdate,
} from "./ReactFiberHooks"

let concurrentQueues: Array<ClassQueue<any>> | null = null

export function pushConcurrentUpdateQueue(queue: ClassQueue<any>) {
  if (concurrentQueues === null) {
    concurrentQueues = [queue]
  } else {
    concurrentQueues.push(queue)
  }
}

export function enqueueConcurrentClassUpdate<State>(
  fiber: Fiber,
  queue: ClassQueue<State>,
  update: ClassUpdate<State>,
  lane: Lane,
) {
  const { interleaved } = queue
  if (interleaved === null) {
    // This is the first update. Create a circular list.
    update.next = update
    // At the end of the current render, this queue's interleaved updates will
    // be transferred to the pending queue.
    pushConcurrentUpdateQueue(queue)
  } else {
    update.next = interleaved.next
    interleaved.next = update
  }
  queue.interleaved = update

  return markUpdateLaneFromFiberToRoot(fiber, lane)
}

function markUpdateLaneFromFiberToRoot(
  sourceFiber: Fiber,
  lane: Lane,
): FiberRoot | null {
  // Update the source fiber's lanes
  sourceFiber.lanes = mergeLanes(sourceFiber.lanes, lane)
  let { alternate } = sourceFiber
  if (alternate !== null) {
    // 为什么要给 alternate.lanes 赋值
    // 可参考 dispatchSetState，从组件挂载到其销毁的过程中，sourceFiber 为同一值
    alternate.lanes = mergeLanes(alternate.lanes, lane)
  }

  // Walk the parent path to the root and update the child lanes.
  let node = sourceFiber
  let parent = sourceFiber.return
  while (parent !== null) {
    parent.childLanes = mergeLanes(parent.childLanes, lane)
    alternate = parent.alternate
    if (alternate !== null) {
      alternate.childLanes = mergeLanes(alternate.childLanes, lane)
    }
    node = parent
    parent = parent.return
  }
  if (node.tag === HostRoot) {
    const root: FiberRoot = node.stateNode
    return root
  }
  return null
}

export function finishQueueingConcurrentUpdates() {
  // Transfer the interleaved updates onto the main queue. Each queue has a
  // `pending` field and an `interleaved` field. When they are not null, they
  // point to the last node in a circular linked list. We need to append the
  // interleaved list to the end of the pending list by joining them into a
  // single, circular list.
  if (concurrentQueues !== null) {
    for (let i = 0; i < concurrentQueues.length; i++) {
      const queue = concurrentQueues[i]
      const lastInterleavedUpdate = queue.interleaved
      if (lastInterleavedUpdate !== null) {
        queue.interleaved = null
        const firstInterleavedUpdate = lastInterleavedUpdate.next
        const lastPendingUpdate = queue.pending
        if (lastPendingUpdate !== null) {
          const firstPendingUpdate = lastPendingUpdate.next
          lastPendingUpdate.next = firstInterleavedUpdate as any
          lastInterleavedUpdate.next = firstPendingUpdate as any
        }
        queue.pending = lastInterleavedUpdate as any
      }
    }
    concurrentQueues = null
  }
}

export function enqueueConcurrentHookUpdate<S, A>(
  fiber: Fiber,
  queue: HookQueue<S, A>,
  update: HookUpdate<S, A>,
  lane: Lane,
) {
  const { interleaved } = queue
  if (interleaved === null) {
    // This is the first update. Create a circular list.
    update.next = update
    // At the end of the current render, this queue's interleaved updates will
    // be transferred to the pending queue.
    pushConcurrentUpdateQueue(queue as any)
  } else {
    update.next = interleaved.next
    interleaved.next = update
  }
  queue.interleaved = update

  return markUpdateLaneFromFiberToRoot(fiber, lane)
}

export function enqueueConcurrentHookUpdateAndEagerlyBailout<S, A>(
  fiber: Fiber,
  queue: HookQueue<S, A>,
  update: HookUpdate<S, A>,
  _lane: Lane,
): void {
  const { interleaved } = queue
  if (interleaved === null) {
    // This is the first update. Create a circular list.
    update.next = update
    // At the end of the current render, this queue's interleaved updates will
    // be transferred to the pending queue.
    pushConcurrentUpdateQueue(queue as any)
  } else {
    update.next = interleaved.next
    interleaved.next = update
  }
  queue.interleaved = update
}
