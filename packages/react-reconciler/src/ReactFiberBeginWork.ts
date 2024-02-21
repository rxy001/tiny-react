import shallowEqual from "shared/shallowEqual"
import type { Fiber } from "./ReactInternalTypes"
import type { Lanes } from "./ReactFiberLane"
import type { RootState } from "./ReactFiberRoot"
import { NoLanes, includesSomeLane } from "./ReactFiberLane"
import {
  FunctionComponent,
  HostRoot,
  HostComponent,
  HostText,
  MemoComponent,
  SimpleMemoComponent,
} from "./ReactWorkTags"
import { ContentReset, Ref } from "./ReactFiberFlags"
import {
  mountChildFibers,
  reconcileChildFibers,
  cloneChildFibers,
} from "./ReactChildFiber"
import {
  cloneUpdateQueue,
  processUpdateQueue,
} from "./ReactFiberClassUpdateQueue"
import { createFiberFromTypeAndProps, createWorkInProgress } from "./ReactFiber"
import { shouldSetTextContent } from "./ReactFiberHostConfig"
import { renderWithHooks, bailoutHooks } from "./ReactFiberHooks"
import { markSkippedUpdateLanes } from "./ReactFiberWorkLoop"

let didReceiveUpdate: boolean = false

export function beginWork(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
): Fiber | null {
  // Before entering the begin phase, clear pending update priority.
  workInProgress.lanes = NoLanes

  if (current !== null) {
    const oldProps = current.memoizedProps
    const newProps = workInProgress.pendingProps

    if (oldProps !== newProps) {
      // If props, mark the fiber as having performed work.
      // This may be unset if the props are determined to be equal later (memo).
      didReceiveUpdate = true
    } else {
      const hasScheduledUpdate = checkScheduledUpdate(current, renderLanes)

      if (!hasScheduledUpdate) {
        didReceiveUpdate = false
        // props 以及 state 均未发生变化，提前退出
        return attemptEarlyBailoutIfNoScheduledUpdate(
          current,
          workInProgress,
          renderLanes,
        )
      }

      // An update was scheduled on this fiber, but there are no new props
      // Set this to false. If an update queue produces a changed value,
      // it will set this to true. Otherwise, the component will assume the
      // children have not changed and bail out.
      didReceiveUpdate = false
    }
  } else {
    didReceiveUpdate = false
  }

  switch (workInProgress.tag) {
    case FunctionComponent: {
      const { pendingProps, type: Component } = workInProgress
      return updateFunctionComponent(
        current,
        workInProgress,
        Component,
        pendingProps,
        renderLanes,
      )
    }
    case HostRoot:
      return updateHostRoot(current, workInProgress, renderLanes)
    case HostComponent:
      return updateHostComponent(current, workInProgress, renderLanes)
    case HostText:
      return updateHostText(current, workInProgress)
    case MemoComponent:
      return updateMemoComponent(
        current,
        workInProgress,
        workInProgress.type,
        workInProgress.pendingProps,
        renderLanes,
      )
    case SimpleMemoComponent:
      return updateSimpleMemoComponent(
        current,
        workInProgress,
        workInProgress.type,
        workInProgress.pendingProps,
        renderLanes,
      )
    default:
      throw new Error(
        `Unknown unit of work tag (${workInProgress.tag}). This error is likely caused by a bug in ` +
          "React. Please file an issue.",
      )
  }
}

function updateFunctionComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  renderLanes: Lanes,
) {
  workInProgress.lanes = NoLanes

  const nextChildren = renderWithHooks(
    current,
    workInProgress,
    Component,
    nextProps,
    renderLanes,
  )

  if (current !== null && !didReceiveUpdate) {
    bailoutHooks(current, workInProgress, renderLanes)
    return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes)
  }

  reconcileChildren(current, workInProgress, nextChildren, renderLanes)
  return workInProgress.child
}

function updateMemoComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  renderLanes: Lanes,
) {
  if (current === null) {
    // type 被包装的组件
    const { type } = Component

    if (typeof type === "function" && Component.compare === null) {
      workInProgress.tag = SimpleMemoComponent
      workInProgress.type = type
      return updateSimpleMemoComponent(
        current,
        workInProgress,
        type,
        nextProps,
        renderLanes,
      )
    }

    const child = createFiberFromTypeAndProps(
      type,
      null,
      nextProps,
      workInProgress,
      workInProgress.mode,
      renderLanes,
    )
    child.ref = workInProgress.ref
    child.return = workInProgress
    workInProgress.child = child
    return child
  }

  const currentChild = current.child as any

  // current 作为 Component fiber 的父 fiber，那 current 实际上是不存在更新的
  // hasScheduledUpdate 只为 false
  const hasScheduledUpdate = checkScheduledUpdate(current, renderLanes)

  if (!hasScheduledUpdate) {
    const prevProps = currentChild.memoizedProps
    // Default to shallow comparison
    let { compare } = Component
    compare = compare !== null ? compare : shallowEqual
    if (compare(prevProps, nextProps) && current.ref === workInProgress.ref) {
      return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes)
    }
  }

  const child = createWorkInProgress(currentChild, nextProps)
  child.ref = workInProgress.ref
  child.return = workInProgress
  workInProgress.child = child
  return child
}

function updateSimpleMemoComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  Component: any,
  nextProps: any,
  renderLanes: Lanes,
) {
  // SimpleMemoComponent 与 FunctionCompoent 的 fiber 只是 tag 和 elementType 不同

  // 能进入该函数说明 nextProps !== prevProps, 此时 didReceiveUpdate 为 true
  if (current !== null) {
    const prevProps = current.memoizedProps

    if (
      shallowEqual(prevProps, nextProps) &&
      current.ref === workInProgress.ref
    ) {
      // 为什么判断 ref ?
      // ref 不存在与 props 中，shallowEqual 只是浅比较.
      // 那么 beginWork 中为啥不判断 ref 呢？
      // nextProps === prevProps 表明父组件未渲染，ref 必然未改变
      didReceiveUpdate = false

      workInProgress.pendingProps = nextProps = prevProps

      // The props are shallowly equal. Reuse the previous props object, like we
      // would during a normal fiber bailout.
      //
      // We don't have strong guarantees that the props object is referentially
      // equal during updates where we can't bail out anyway — like if the props
      // are shallowly equal, but there's a local state or context update in the
      // same batch.
      //
      // However, as a principle, we should aim to make the behavior consistent
      // across different ways of memoizing a component. For example, React.memo
      // has a different internal Fiber layout if you pass a normal function
      // component (SimpleMemoComponent) versus if you pass a different type
      // like forwardRef (MemoComponent). But this is an implementation detail.
      // Wrapping a component in forwardRef (or React.lazy, etc) shouldn't
      // affect whether the props object is reused during a bailout.
      const hasScheduledUpdate = checkScheduledUpdate(current, renderLanes)

      // current 实际上与 Component 相关联.
      // 那么 dispatchSetState 绑定的就是 current 或 current.alternate
      if (!hasScheduledUpdate) {
        return bailoutOnAlreadyFinishedWork(
          current,
          workInProgress,
          renderLanes,
        )
      }
    }
  }

  return updateFunctionComponent(
    current,
    workInProgress,
    Component,
    nextProps,
    renderLanes,
  )
}

function updateHostRoot(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  if (current === null) {
    throw new Error("Should have a current fiber. This is a bug in React.")
  }

  const nextProps = workInProgress.pendingProps

  cloneUpdateQueue(current, workInProgress)
  processUpdateQueue(workInProgress, nextProps, null, renderLanes)

  const nextState: RootState = workInProgress.memoizedState

  const nextChildren = nextState.element
  reconcileChildren(current, workInProgress, nextChildren, renderLanes)

  return workInProgress.child
}

function updateHostComponent(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  const { type } = workInProgress
  const nextProps = workInProgress.pendingProps
  const prevProps = current !== null ? current.memoizedProps : null

  let nextChildren = nextProps.children
  const isDirectTextChild = shouldSetTextContent(type, nextProps)

  if (isDirectTextChild) {
    // We special case a direct text child of a host node. This is a common
    // case. We won't handle it as a reified child. We will instead handle
    // this in the host environment that also has access to this prop. That
    // avoids allocating another HostText fiber and traversing it.
    nextChildren = null
  } else if (prevProps !== null && shouldSetTextContent(type, prevProps)) {
    // If we're switching from a direct text child to a normal child, or to
    // empty, we need to schedule the text content to be reset.
    workInProgress.flags |= ContentReset
  }
  markRef(current, workInProgress)
  reconcileChildren(current, workInProgress, nextChildren, renderLanes)
  return workInProgress.child
}

export function reconcileChildren(
  current: Fiber | null,
  workInProgress: Fiber,
  nextChildren: any,
  renderLanes: Lanes,
) {
  if (current === null) {
    // If this is a fresh new component that hasn't been rendered yet, we
    // won't update its child set by applying minimal side-effects. Instead,
    // we will add them all to the child before it gets rendered. That means
    // we can optimize this reconciliation pass by not tracking side-effects.
    workInProgress.child = mountChildFibers(
      workInProgress,
      null,
      nextChildren,
      renderLanes,
    )
  } else {
    // If the current child is the same as the work in progress, it means that
    // we haven't yet started any work on these children. Therefore, we use
    // the clone algorithm to create a copy of all the current children.

    // If we had any progressed work already, that is invalid at this point so
    // let's throw it out.
    workInProgress.child = reconcileChildFibers(
      workInProgress,
      current.child,
      nextChildren,
      renderLanes,
    )
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
function updateHostText(_current: Fiber | null, _workInProgress: Fiber) {
  // Nothing to do here. This is terminal. We'll do the completion step
  // immediately after.
  return null
}

function markRef(current: Fiber | null, workInProgress: Fiber) {
  const { ref } = workInProgress
  if (
    (current === null && ref !== null) ||
    (current !== null && current.ref !== ref)
  ) {
    // Schedule a Ref effect
    workInProgress.flags |= Ref
  }
}

function checkScheduledUpdate(current: Fiber, renderLanes: Lanes): boolean {
  // Before performing an early bailout, we must check if there are pending
  // updates or context.
  const updateLanes = current.lanes
  if (includesSomeLane(updateLanes, renderLanes)) {
    return true
  }
  return false
}

function attemptEarlyBailoutIfNoScheduledUpdate(
  current: Fiber,
  workInProgress: Fiber,
  renderLanes: Lanes,
) {
  // This fiber does not have any pending work. Bailout without entering
  // the begin phase. There's still some bookkeeping we that needs to be done
  // in this optimized path, mostly pushing stuff onto the stack.

  return bailoutOnAlreadyFinishedWork(current, workInProgress, renderLanes)
}

function bailoutOnAlreadyFinishedWork(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
): Fiber | null {
  markSkippedUpdateLanes(workInProgress.lanes)

  // Check if the children have any pending work.
  if (!includesSomeLane(renderLanes, workInProgress.childLanes)) {
    // The children don't have any work either. We can skip them.
    return null
  }

  // This fiber doesn't have work, but its subtree does. Clone the child
  // fibers and continue.
  // workInProgress 没有需要提交的更新，克隆其 children fiber，因此 children 的 props 未发生变化
  cloneChildFibers(current, workInProgress)
  return workInProgress.child
}

export function markWorkInProgressReceivedUpdate() {
  didReceiveUpdate = true
}

export function checkIfWorkInProgressReceivedUpdate() {
  return didReceiveUpdate
}
