import type { Fiber } from "./ReactInternalTypes"
import type { Lanes } from "./ReactFiberLane"
import type { RootState } from "./ReactFiberRoot"
import { NoLanes } from "./ReactFiberLane"
import {
  IndeterminateComponent,
  FunctionComponent,
  HostRoot,
  HostComponent,
  HostText,
} from "./ReactWorkTags"
import { ContentReset, Ref } from "./ReactFiberFlags"
import { mountChildFibers, reconcileChildFibers } from "./ReactChildFiber"
import {
  cloneUpdateQueue,
  processUpdateQueue,
} from "./ReactFiberClassUpdateQueue"
import { shouldSetTextContent } from "./ReactFiberHostConfig"
import { renderWithHooks } from "./ReactFiberHooks"

export function beginWork(
  current: Fiber | null,
  workInProgress: Fiber,
  renderLanes: Lanes,
): Fiber | null {
  // Before entering the begin phase, clear pending update priority.
  workInProgress.lanes = NoLanes

  switch (workInProgress.tag) {
    // 把 IndeterminateComponent 当成 FunctionComponent 处理
    case IndeterminateComponent:
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

  reconcileChildren(current, workInProgress, nextChildren, renderLanes)
  return workInProgress.child
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
