import type { FiberRoot, Fiber } from "./ReactInternalTypes"
import type { Lane, Lanes } from "./ReactFiberLane"
import {
  NoLanes,
  SyncLane,
  markRootUpdated,
  getNextLanes,
  includesSomeLane,
  getHighestPriorityLane,
  mergeLanes,
  markRootFinished,
} from "./ReactFiberLane"
import { Incomplete, NoFlags, MutationMask } from "./ReactFiberFlags"
import {
  scheduleSyncCallback,
  flushSyncCallbacks,
} from "./ReactFiberSyncTaskQueue"
import { createWorkInProgress } from "./ReactFiber"
import { finishQueueingConcurrentUpdates } from "./ReactFiberConcurrentUpdates"
import { beginWork } from "./ReactFiberBeginWork"
import { completeWork } from "./ReactFiberCompleteWork"
import { commitMutationEffects } from "./ReactFiberCommitWork"
import { scheduleMicrotask } from "./ReactFiberHostConfig"

type ExecutionContext = number

export const NoContext = /*             */ 0b000
const RenderContext = /*                */ 0b010
const CommitContext = /*                */ 0b100

// Describes where we are in the React execution stack
let executionContext: ExecutionContext = NoContext
// The root we're working on
let workInProgressRoot: FiberRoot | null = null
// The fiber we're working on
let workInProgress: Fiber | null = null
// The lanes we're rendering
let workInProgressRootRenderLanes: Lanes = NoLanes

// Most things in the work loop should deal with workInProgressRootRenderLanes.
// Most things in begin/complete phases should deal with subtreeRenderLanes.
// eslint-disable-next-line import/no-mutable-exports
export let subtreeRenderLanes: Lanes = NoLanes

export function requestEventTime() {
  return performance.now()
}

export function requestUpdateLane(_fiber: Fiber): Lane {
  // Special cases
  return SyncLane
}

export function scheduleUpdateOnFiber(
  root: FiberRoot,
  fiber: Fiber,
  lane: Lane,
  eventTime: number,
) {
  // Mark that the root has a pending update.
  markRootUpdated(root, lane, eventTime)

  ensureRootIsScheduled(root)
}

// Use this function to schedule a task for a root. There's only one task per
// root; if a task was already scheduled, we'll check to make sure the priority
// of the existing task is the same as the priority of the next level that the
// root has work on. This function is called on every update, and right before
// exiting a task.
function ensureRootIsScheduled(root: FiberRoot) {
  // Determine the next lanes to work on, and their priority.
  const nextLanes = getNextLanes(root, NoLanes)

  if (nextLanes === NoLanes) {
    return
  }

  // We use the highest priority lane to represent the priority of the callback.
  const newCallbackPriority = getHighestPriorityLane(nextLanes)

  // Schedule a new callback.
  if (newCallbackPriority === SyncLane) {
    // Special case: Sync React callbacks are scheduled on a special
    // internal queue
    scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root))

    // 注册微任务执行同步任务，由此带来自动批处理
    scheduleMicrotask(() => {
      if ((executionContext & (RenderContext | CommitContext)) === NoContext) {
        // Note that this would still prematurely flush the callbacks
        // if this happens outside render or commit phase (e.g. in an event).
        flushSyncCallbacks()
      }
    })
  }
}

// This is the entry point for synchronous tasks that don't go
// through Scheduler
function performSyncWorkOnRoot(root: FiberRoot) {
  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    throw new Error("Should not already be working.")
  }

  const lanes = getNextLanes(root, NoLanes)
  if (!includesSomeLane(lanes, SyncLane)) {
    // There's no remaining sync work left.
    ensureRootIsScheduled(root)
    return null
  }

  renderRootSync(root, lanes)

  // We now have a consistent tree. Because this is a sync render, we
  // will commit it even if something suspended.
  const finishedWork: Fiber = root.current.alternate as any
  root.finishedWork = finishedWork
  root.finishedLanes = lanes

  commitRoot(root)

  // Before exiting, make sure there's a callback scheduled for the next
  // pending level.
  ensureRootIsScheduled(root)

  return null
}

function renderRootSync(root: FiberRoot, lanes: Lanes) {
  const prevExecutionContext = executionContext
  executionContext |= RenderContext

  // If the root or lanes have changed, throw out the existing stack
  // and prepare a fresh one. Otherwise we'll continue where we left off.
  if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) {
    prepareFreshStack(root, lanes)
  }

  do {
    try {
      workLoopSync()
      break
    } catch (thrownValue) {
      /* empty */
    }
  } while (true)

  executionContext = prevExecutionContext

  if (workInProgress !== null) {
    // This is a sync render, so we should have finished the whole tree.
    throw new Error(
      "Cannot commit an incomplete root. This error is likely caused by a " +
        "bug in React. Please file an issue.",
    )
  }

  // Set this to null to indicate there's no in-progress render.
  workInProgressRoot = null
  workInProgressRootRenderLanes = NoLanes
}

function prepareFreshStack(root: FiberRoot, lanes: Lanes): Fiber {
  root.finishedWork = null
  root.finishedLanes = NoLanes

  workInProgressRoot = root
  const rootWorkInProgress = createWorkInProgress(root.current, null)
  workInProgress = rootWorkInProgress
  workInProgressRootRenderLanes = subtreeRenderLanes = lanes

  finishQueueingConcurrentUpdates()

  return rootWorkInProgress
}

function workLoopSync() {
  // Already timed out, so perform work without checking if we need to yield.
  while (workInProgress !== null) {
    performUnitOfWork(workInProgress)
  }
}

function performUnitOfWork(unitOfWork: Fiber): void {
  // The current, flushed, state of this fiber is the alternate. Ideally
  // nothing should rely on this, but relying on it here means that we don't
  // need an additional field on the work in progress.
  const current = unitOfWork.alternate

  const next = beginWork(current, unitOfWork, subtreeRenderLanes)

  unitOfWork.memoizedProps = unitOfWork.pendingProps
  if (next === null) {
    // If this doesn't spawn new work, complete the current work.
    completeUnitOfWork(unitOfWork)
  } else {
    workInProgress = next
  }
}

function completeUnitOfWork(unitOfWork: Fiber): void {
  // Attempt to complete the current unit of work, then move to the next
  // sibling. If there are no more siblings, return to the parent fiber.
  let completedWork = unitOfWork
  do {
    // The current, flushed, state of this fiber is the alternate. Ideally
    // nothing should rely on this, but relying on it here means that we don't
    // need an additional field on the work in progress.
    const current = completedWork.alternate
    const returnFiber = completedWork.return

    // Check if the work completed or if something threw.
    if ((completedWork.flags & Incomplete) === NoFlags) {
      completeWork(current, completedWork, subtreeRenderLanes)
    }
    const siblingFiber = completedWork.sibling
    if (siblingFiber !== null) {
      // If there is more work to do in this returnFiber, do that next.
      workInProgress = siblingFiber
      return
    }
    // Otherwise, return to the parent
    completedWork = returnFiber as Fiber
    // Update the next thing we're working on in case something throws.
    workInProgress = completedWork
  } while (completedWork !== null)
}

function commitRoot(root: FiberRoot) {
  commitRootImpl(root)
  return null
}

function commitRootImpl(root: FiberRoot) {
  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    throw new Error("Should not already be working.")
  }

  const { finishedWork } = root
  const lanes = root.finishedLanes

  if (finishedWork === null) {
    return null
  }
  root.finishedWork = null
  root.finishedLanes = NoLanes

  // rootFiber 是在 createFiberRoot 时创建了。初次挂载时，在刷新栈帧时生成 rootWorkInProgress(rootFiber),
  // 两者以 alternate 链接。之后每次更新都复用 root.current.alternate.
  // legacy render 如果 container 发生了变化，那么会重新执行 createFiberRoot.
  if (finishedWork === root.current) {
    throw new Error(
      "Cannot commit the same tree as before. This error is likely caused by " +
        "a bug in React. Please file an issue.",
    )
  }

  // Update the first and last pending times on this root. The new first
  // pending time is whatever is left on the root fiber.
  let remainingLanes = mergeLanes(finishedWork.lanes, finishedWork.childLanes)
  markRootFinished(root, remainingLanes)

  if (root === workInProgressRoot) {
    // We can reset these now that they are finished.
    workInProgressRoot = null
    workInProgress = null
    workInProgressRootRenderLanes = NoLanes
  } else {
    // This indicates that the last root we worked on is not the same one that
    // we're committing now. This most commonly happens when a suspended root
    // times out.
  }

  // Check if there are any effects in the whole tree.
  const subtreeHasEffects =
    (finishedWork.subtreeFlags & MutationMask) !== NoFlags
  const rootHasEffect = (finishedWork.flags & MutationMask) !== NoFlags

  if (subtreeHasEffects || rootHasEffect) {
    const prevExecutionContext = executionContext
    executionContext |= CommitContext

    // Reset this to null before calling lifecycles

    // The next phase is the mutation phase, where we mutate the host tree.
    commitMutationEffects(root, finishedWork, lanes)

    // The work-in-progress tree is now the current tree. This must come after
    // the mutation phase, so that the previous tree is still current during
    // componentWillUnmount, but before the layout phase, so that the finished
    // work is current during componentDidMount/Update.
    root.current = finishedWork

    executionContext = prevExecutionContext
  } else {
    // No effects.
    root.current = finishedWork
  }

  // Read this again, since an effect might have updated it
  remainingLanes = root.pendingLanes

  // Always call this before exiting `commitRoot`, to ensure that any
  // additional work on this root is scheduled.
  ensureRootIsScheduled(root)

  return null
}
