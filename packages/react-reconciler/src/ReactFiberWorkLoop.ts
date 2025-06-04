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
  markStarvedLanesAsExpired,
  includesExpiredLane,
  includesBlockingLane,
  NoLane,
  pickArbitraryLane,
} from "./ReactFiberLane"
import {
  Incomplete,
  NoFlags,
  MutationMask,
  PassiveMask,
} from "./ReactFiberFlags"
import {
  scheduleSyncCallback,
  flushSyncCallbacks,
} from "./ReactFiberSyncTaskQueue"
import { NoMode, ConcurrentMode } from "./ReactTypeOfMode"
import { createWorkInProgress } from "./ReactFiber"
import { finishQueueingConcurrentUpdates } from "./ReactFiberConcurrentUpdates"
import { beginWork } from "./ReactFiberBeginWork"
import { completeWork } from "./ReactFiberCompleteWork"
import {
  commitMutationEffects,
  commitPassiveUnmountEffects,
  commitPassiveMountEffects,
  commitLayoutEffects,
} from "./ReactFiberCommitWork"
import {
  scheduleMicrotask,
  getCurrentEventPriority,
} from "./ReactFiberHostConfig"
import {
  DiscreteEventPriority,
  ContinuousEventPriority,
  DefaultEventPriority,
  IdleEventPriority,
  lanesToEventPriority,
  getCurrentUpdatePriority,
  lowerEventPriority,
  setCurrentUpdatePriority,
} from "./ReactEventPriorities"
import {
  scheduleCallback,
  cancelCallback,
  shouldYield,
  now,
  ImmediatePriority as ImmediateSchedulerPriority,
  UserBlockingPriority as UserBlockingSchedulerPriority,
  NormalPriority as NormalSchedulerPriority,
  IdlePriority as IdleSchedulerPriority,
} from "./Scheduler"

type RootExitStatus = 0 | 1 | 5
const RootInProgress = 0
const RootFatalErrored = 1
// const RootErrored = 2
// const RootSuspended = 3
// const RootSuspendedWithDelay = 4
const RootCompleted = 5
// const RootDidNotComplete = 6

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
// The work left over by components that were visited during this render. Only
// includes unprocessed updates, not work in bailed out children.
let workInProgressRootSkippedLanes: Lanes = NoLanes

// Whether to root completed, errored, suspended, etc.
let workInProgressRootExitStatus: RootExitStatus = RootInProgress

let rootDoesHavePassiveEffects: boolean = false
let rootWithPendingPassiveEffects: FiberRoot | null = null

let pendingPassiveEffectsLanes: Lanes = NoLanes

// Most things in the work loop should deal with workInProgressRootRenderLanes.
// Most things in begin/complete phases should deal with subtreeRenderLanes.
// eslint-disable-next-line import/no-mutable-exports
export let subtreeRenderLanes: Lanes = NoLanes

export function requestEventTime() {
  return now()
}

export function requestUpdateLane(fiber: Fiber): Lane {
  const { mode } = fiber
  if ((mode & ConcurrentMode) === NoMode) {
    return SyncLane as Lane
  }
  if (
    (executionContext & RenderContext) !== NoContext &&
    workInProgressRootRenderLanes !== NoLanes
  ) {
    // This is a render phase update. These are not officially supported. The
    // old behavior is to give this the same "thread" (lanes) as
    // whatever is currently rendering. So if you call `setState` on a component
    // that happens later in the same render, it will flush. Ideally, we want to
    // remove the special case and treat them as if they came from an
    // interleaved event. Regardless, this pattern is not officially supported.
    // This behavior is only a fallback. The flag only exists until we can roll
    // out the setState warning, since existing code might accidentally rely on
    // the current behavior.
    return pickArbitraryLane(workInProgressRootRenderLanes)
  }

  const updateLane: Lane = getCurrentUpdatePriority() as any
  if (updateLane !== NoLane) {
    return updateLane
  }

  // This update originated outside React. Ask the host environment for an
  // appropriate priority, based on the type of event.
  //
  // The opaque type returned by the host config is internally a lane, so we can
  // use that directly.
  // TODO: Move this type conversion to the event priority module.
  const eventLane: Lane = getCurrentEventPriority() as any
  return eventLane
}

export function scheduleUpdateOnFiber(
  root: FiberRoot,
  fiber: Fiber,
  lane: Lane,
  eventTime: number,
) {
  // Mark that the root has a pending update.
  markRootUpdated(root, lane, eventTime)

  if (
    (executionContext & RenderContext) !== NoLanes &&
    root === workInProgressRoot
  ) {
    // This update was dispatched during the render phase. This is a mistake
    // if the update originates from user space (with the exception of local
    // hook updates, which are handled differently and don't reach this
    // function), but there are some internal React features that use this as
    // an implementation detail, like selective hydration.

    // 在协调阶段某组件渲染时触发了另外一个组件的 setState, 这是一种错误行为. 但 react 也会去更新，
    // 此 update 会在下次渲染中处理
    // 这里跟 dispatchSetState 中 RenderPhaseUpdate 不同.
    console.error(
      "Cannot update a component while rendering a " +
        "different component. To locate the bad setState() call ",
    )
  } else {
    ensureRootIsScheduled(root, eventTime)
  }
}

// Use this function to schedule a task for a root. There's only one task per
// root; if a task was already scheduled, we'll check to make sure the priority
// of the existing task is the same as the priority of the next level that the
// root has work on. This function is called on every update, and right before
// exiting a task.
function ensureRootIsScheduled(root: FiberRoot, currentTime: number) {
  const existingCallbackNode = root.callbackNode

  // Check if any lanes are being starved by other work. If so, mark them as
  // expired so we know to work on those next.
  markStarvedLanesAsExpired(root, currentTime)

  // Determine the next lanes to work on, and their priority.
  const nextLanes = getNextLanes(
    root,
    // concurrent mode 时准备让步给浏览器时，确定下次工作的优先级
    root === workInProgressRoot ? workInProgressRootRenderLanes : NoLanes,
  )

  if (nextLanes === NoLanes) {
    if (existingCallbackNode !== null) {
      // 不会出现这种情况
      cancelCallback(existingCallbackNode)
    }
    root.callbackNode = null
    root.callbackPriority = NoLane
    return
  }

  // We use the highest priority lane to represent the priority of the callback.
  const newCallbackPriority = getHighestPriorityLane(nextLanes)

  const existingCallbackPriority = root.callbackPriority

  if (existingCallbackPriority === newCallbackPriority) {
    return
  }

  if (existingCallbackNode != null) {
    // Cancel the existing callback. We'll schedule a new one below.
    cancelCallback(existingCallbackNode)
  }

  let newCallbackNode
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
    newCallbackNode = null
  } else {
    let schedulerPriorityLevel
    switch (lanesToEventPriority(nextLanes)) {
      case DiscreteEventPriority:
        schedulerPriorityLevel = ImmediateSchedulerPriority
        break
      case ContinuousEventPriority:
        schedulerPriorityLevel = UserBlockingSchedulerPriority
        break
      case DefaultEventPriority:
        schedulerPriorityLevel = NormalSchedulerPriority
        break
      case IdleEventPriority:
        schedulerPriorityLevel = IdleSchedulerPriority
        break
      default:
        schedulerPriorityLevel = NormalSchedulerPriority
        break
    }
    newCallbackNode = scheduleCallback(
      schedulerPriorityLevel,
      performConcurrentWorkOnRoot.bind(null, root),
    )
  }

  root.callbackPriority = newCallbackPriority
  root.callbackNode = newCallbackNode
}

// This is the entry point for synchronous tasks that don't go
// through Scheduler
function performSyncWorkOnRoot(root: FiberRoot) {
  flushPassiveEffects()

  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    throw new Error("Should not already be working.")
  }

  const lanes = getNextLanes(root, NoLanes)
  if (!includesSomeLane(lanes, SyncLane)) {
    // There's no remaining sync work left.
    ensureRootIsScheduled(root, now())
    return null
  }

  const exitStatus = renderRootSync(root, lanes)

  if (exitStatus !== RootCompleted) {
    throw new Error("This is a bug in React.")
  }

  // We now have a consistent tree. Because this is a sync render, we
  // will commit it even if something suspended.
  const finishedWork: Fiber = root.current.alternate as any
  root.finishedWork = finishedWork
  root.finishedLanes = lanes

  commitRoot(root)

  // Before exiting, make sure there's a callback scheduled for the next
  // pending level.
  ensureRootIsScheduled(root, now())

  return null
}

function performConcurrentWorkOnRoot(
  root: FiberRoot,
  didTimeout: boolean,
): any {
  const originalCallbackNode = root.callbackNode

  // 确保组件 rerender 后 PassiveEffect 都会执行.
  // 在 concurrent mode 中, PassiveEffects 执行时机有两种
  // 1. 由 SyncLanes 更新任务产生的 PassiveEffects 同步执行.
  // 2. 其它优先级更新任务产生的 PassiveEffects 异步执行(PassiveEffect 宏任务).
  const didFlushPassiveEffects = flushPassiveEffects()

  if (didFlushPassiveEffects) {
    // Something in the passive effect phase may have canceled the current task.
    // Check if the task node for this root was changed.
    if (root.callbackNode !== originalCallbackNode) {
      // The current task was canceled. Exit. We don't need to call
      // `ensureRootIsScheduled` because the check above implies either that
      // there's a new task, or that there's no remaining work on this root.
      return null
    }
  }

  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    throw new Error("Should not already be working.")
  }

  // Flush any pending passive effects before deciding which lanes to work on,
  // in case they schedule additional work.

  // Determine the next lanes to work on, using the fields stored
  // on the root.
  // 时间切片分步执行 performConcurrentWorkOnRoot ，因此每次执行都需要获取 nextLanes
  const lanes = getNextLanes(
    root,
    root === workInProgressRoot ? workInProgressRootRenderLanes : NoLanes,
  )

  // We disable time-slicing in some cases: if the work has been CPU-bound
  // for too long ("expired" work, to prevent starvation), or we're in
  // sync-updates-by-default mode.

  // 目前启用时间切片的方法只有使用 transition 。
  const shouldTimeSlice =
    !includesBlockingLane(root, lanes) &&
    !includesExpiredLane(root, lanes) &&
    !didTimeout

  const exitStatus = shouldTimeSlice
    ? renderRootConcurrent(root, lanes)
    : renderRootSync(root, lanes)

  if (exitStatus !== RootInProgress) {
    if (exitStatus === RootCompleted) {
      // The render completed.
      // We now have a consistent tree. The next step is either to commit it,
      // or, if something suspended, wait to commit it after a timeout.
      const finishedWork: Fiber = root.current.alternate as any

      root.finishedWork = finishedWork
      root.finishedLanes = lanes
      finishConcurrentRender(root, exitStatus, lanes)
    }
  }

  // 确定下次任务的优先级，如果有更高优先级的任务需要执行，就终止本次渲染
  ensureRootIsScheduled(root, now())
  if (root.callbackNode === originalCallbackNode) {
    // The task node scheduled for this root is the same one that's
    // currently executed. Need to return a continuation.
    return performConcurrentWorkOnRoot.bind(null, root)
  }
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
      console.log(thrownValue)
      workInProgressRootExitStatus = RootFatalErrored
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

  return workInProgressRootExitStatus
}

function renderRootConcurrent(root: FiberRoot, lanes: Lanes) {
  const prevExecutionContext = executionContext
  executionContext |= RenderContext

  // If the root or lanes have changed, throw out the existing stack
  // and prepare a fresh one. Otherwise we'll continue where we left off.
  // x-todo：条件成立的情景
  if (workInProgressRoot !== root || workInProgressRootRenderLanes !== lanes) {
    prepareFreshStack(root, lanes)
  }

  do {
    try {
      workLoopConcurrent()
      break
    } catch (thrownValue) {
      console.log(thrownValue)
      workInProgressRootExitStatus = RootFatalErrored
    }
  } while (true)
  executionContext = prevExecutionContext

  // Check if the tree has completed.
  if (workInProgress !== null) {
    // Still work remaining.
    return RootInProgress
  }
  // Set this to null to indicate there's no in-progress render.
  workInProgressRoot = null
  workInProgressRootRenderLanes = NoLanes

  // Return the final exit status.
  return workInProgressRootExitStatus
}

function workLoopConcurrent() {
  while (workInProgress !== null && !shouldYield()) {
    performUnitOfWork(workInProgress)
  }
}

function prepareFreshStack(root: FiberRoot, lanes: Lanes): Fiber {
  root.finishedWork = null
  root.finishedLanes = NoLanes

  workInProgressRoot = root
  const rootWorkInProgress = createWorkInProgress(root.current, null)
  workInProgress = rootWorkInProgress
  workInProgressRootRenderLanes = subtreeRenderLanes = lanes
  workInProgressRootSkippedLanes = NoLanes
  workInProgressRootExitStatus = RootInProgress

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

  // We've reached the root.
  if (workInProgressRootExitStatus === RootInProgress) {
    workInProgressRootExitStatus = RootCompleted
  }
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

  if (
    (finishedWork.subtreeFlags & PassiveMask) !== NoFlags ||
    (finishedWork.flags & PassiveMask) !== NoFlags
  ) {
    if (!rootDoesHavePassiveEffects) {
      rootDoesHavePassiveEffects = true
      scheduleCallback(NormalSchedulerPriority, () => {
        flushPassiveEffects()
        // This render triggered passive effects: release the root cache pool
        // *after* passive effects fire to avoid freeing a cache pool that may
        // be referenced by a node in the tree (HostRoot, Cache boundary etc)
        return null
      })
    }
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

    commitLayoutEffects(finishedWork)

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

  if (rootDoesHavePassiveEffects) {
    // This commit has passive effects. Stash a reference to them. But don't
    // schedule a callback until after flushing layout work.
    rootDoesHavePassiveEffects = false
    rootWithPendingPassiveEffects = root
    pendingPassiveEffectsLanes = lanes
  }

  // If the passive effects are the result of a discrete render, flush them
  // synchronously at the end of the current task so that the result is
  // immediately observable. Otherwise, we assume that they are not
  // order-dependent and do not need to be observed by external systems, so we
  // can wait until after paint.
  if (includesSomeLane(pendingPassiveEffectsLanes, SyncLane)) {
    flushPassiveEffects()
  }

  // Read this again, since an effect might have updated it
  remainingLanes = root.pendingLanes

  // Always call this before exiting `commitRoot`, to ensure that any
  // additional work on this root is scheduled.
  // render 阶段可能会产生新的 update
  ensureRootIsScheduled(root, now())

  return null
}

function finishConcurrentRender(
  root: FiberRoot,
  exitStatus: RootExitStatus,
  _lanes: Lanes,
) {
  switch (exitStatus) {
    case RootInProgress:
    case RootFatalErrored: {
      throw new Error("Root did not complete. This is a bug in React.")
    }
    case RootCompleted: {
      // The work completed. Ready to commit.
      commitRoot(root)
      break
    }
    default: {
      throw new Error("Unknown root exit status.")
    }
  }
}

export function markSkippedUpdateLanes(lane: Lane | Lanes): void {
  workInProgressRootSkippedLanes = mergeLanes(
    lane,
    workInProgressRootSkippedLanes,
  )
}

export function flushPassiveEffects(): boolean {
  if (rootWithPendingPassiveEffects !== null) {
    const renderPriority = lanesToEventPriority(pendingPassiveEffectsLanes)

    // 目前不存在 offscreenComponent，因此 renderPriority 最低为 DefaultEventPriority
    // 通过 lowerEventPriority 比较后，priority 只能为 DefaultEventPriority
    const priority = lowerEventPriority(DefaultEventPriority, renderPriority)
    const previousPriority = getCurrentUpdatePriority()

    try {
      setCurrentUpdatePriority(priority)
      return flushPassiveEffectsImpl()
    } finally {
      setCurrentUpdatePriority(previousPriority)
      // Once passive effects have run for the tree - giving components a
      // chance to retain cache instances they use - release the pooled
      // cache at the root (if there is one)
    }
  }
  return false
}

function flushPassiveEffectsImpl() {
  if (rootWithPendingPassiveEffects === null) {
    return false
  }

  const root = rootWithPendingPassiveEffects
  rootWithPendingPassiveEffects = null
  // TODO: This is sometimes out of sync with rootWithPendingPassiveEffects.
  // Figure out why and fix it. It's not causing any known issues (probably
  // because it's only used for profiling), but it's a refactor hazard.
  pendingPassiveEffectsLanes = NoLanes

  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    throw new Error("Cannot flush passive effects while already rendering.")
  }

  const prevExecutionContext = executionContext
  executionContext |= CommitContext

  commitPassiveUnmountEffects(root.current)
  commitPassiveMountEffects(root.current)

  executionContext = prevExecutionContext

  flushSyncCallbacks()

  return true
}
