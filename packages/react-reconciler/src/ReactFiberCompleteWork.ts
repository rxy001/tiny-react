import type { Fiber } from "./ReactInternalTypes"
import type { Lanes } from "./ReactFiberLane"
import type { Type, Props, Instance } from "./ReactFiberHostConfig"
import {
  IndeterminateComponent,
  FunctionComponent,
  HostRoot,
  HostComponent,
  HostText,
} from "./ReactWorkTags"
import { NoFlags, StaticMask, Update } from "./ReactFiberFlags"
import { NoLanes, mergeLanes } from "./ReactFiberLane"
import {
  createInstance,
  prepareUpdate,
  appendInitialChild,
  finalizeInitialChildren,
  createTextInstance,
} from "./ReactFiberHostConfig"

function markUpdate(workInProgress: Fiber) {
  // Tag the fiber with an update effect. This turns a Placement into
  // a PlacementAndUpdate.
  workInProgress.flags |= Update
}

export function completeWork(
  current: Fiber | null,
  workInProgress: Fiber,
  _renderLanes: Lanes,
): Fiber | null {
  const newProps = workInProgress.pendingProps
  // Note: This intentionally doesn't check if we're hydrating because comparing
  // to the current tree provider fiber is just as fast and less error-prone.
  // Ideally we would have a special version of the work loop only
  // for hydration.
  switch (workInProgress.tag) {
    case IndeterminateComponent:
    case FunctionComponent:
    case HostRoot: {
      bubbleProperties(workInProgress)
      return null
    }
    case HostComponent: {
      const { type } = workInProgress
      if (current !== null && workInProgress.stateNode != null) {
        updateHostComponent(current, workInProgress, type, newProps)
      } else {
        if (!newProps) {
          if (workInProgress.stateNode === null) {
            throw new Error(
              "We must have new props for new mounts. This error is likely " +
                "caused by a bug in React. Please file an issue.",
            )
          }

          // This can happen when we abort work.
          bubbleProperties(workInProgress)
          return null
        }

        // TODO: Move createInstance to beginWork and keep it on a context
        // "stack" as the parent. Then append children as we go in beginWork
        // or completeWork depending on whether we want to add them top->down or
        // bottom->up. Top->down is faster in IE11.
        const instance = createInstance(type, newProps, workInProgress)

        // 新建 HostComponent, 那么其子树也必是新建的，因此先在这添加最近子 DOM 实例。
        // 而新建子树的根节点 DOM 实例，其 fiber 将会被标记为 Placement， 在 commit 阶段处理
        appendAllChildren(instance, workInProgress)

        workInProgress.stateNode = instance

        // Certain renderers require commit-time effects for initial mount.
        // (eg DOM renderer supports auto-focus for certain elements).
        // Make sure such renderers get scheduled for later work.
        if (finalizeInitialChildren(instance, type, newProps)) {
          markUpdate(workInProgress)
        }
      }
      bubbleProperties(workInProgress)
      return null
    }
    case HostText: {
      const newText = newProps
      if (current && workInProgress.stateNode != null) {
        const oldText = current.memoizedProps
        // If we have an alternate, that means this is an update and we need
        // to schedule a side-effect to do the updates.
        updateHostText(current, workInProgress, oldText, newText)
      } else {
        if (typeof newText !== "string") {
          if (workInProgress.stateNode === null) {
            throw new Error(
              "We must have new props for new mounts. This error is likely " +
                "caused by a bug in React. Please file an issue.",
            )
          }
          // This can happen when we abort work.
        }
        workInProgress.stateNode = createTextInstance(newText, workInProgress)
      }
      bubbleProperties(workInProgress)
      return null
    }
    default:
      throw new Error(
        `Unknown unit of work tag (${workInProgress.tag}). This error is likely caused by a bug in ` +
          "React. Please file an issue.",
      )
  }
}

function bubbleProperties(completedWork: Fiber) {
  // completedWork.alternate.child === completedWork.child，表示完全跳过 completedWork 子树的渲染.
  // 如果 completedWork.alternate !== null && completedWork.alternate.child !== completedWork.child
  // 说明 completedWork 复用了 completedWork.alternate.alternate 的 fiber，而非跳过子树的渲染
  const didBailout =
    completedWork.alternate !== null &&
    completedWork.alternate.child === completedWork.child

  let newChildLanes = NoLanes
  let subtreeFlags = NoFlags

  if (!didBailout) {
    // Bubble up the earliest expiration time.
    let { child } = completedWork
    while (child !== null) {
      newChildLanes = mergeLanes(
        newChildLanes,
        mergeLanes(child.lanes, child.childLanes),
      )

      subtreeFlags |= child.subtreeFlags
      subtreeFlags |= child.flags

      // Update the return pointer so the tree is consistent. This is a code
      // smell because it assumes the commit phase is never concurrent with
      // the render phase. Will address during refactor to alternate model.
      child.return = completedWork

      child = child.sibling
    }
  } else {
    // Bubble up the earliest expiration time.
    let { child } = completedWork
    while (child !== null) {
      newChildLanes = mergeLanes(
        newChildLanes,
        mergeLanes(child.lanes, child.childLanes),
      )

      // "Static" flags share the lifetime of the fiber/hook they belong to,
      // so we should bubble those up even during a bailout. All the other
      // flags have a lifetime only of a single render + commit, so we should
      // ignore them.
      // 删除非 Stasic tag
      subtreeFlags |= child.subtreeFlags & StaticMask
      subtreeFlags |= child.flags & StaticMask

      // Update the return pointer so the tree is consistent. This is a code
      // smell because it assumes the commit phase is never concurrent with
      // the render phase. Will address during refactor to alternate model.
      child.return = completedWork

      child = child.sibling
    }
  }

  completedWork.subtreeFlags |= subtreeFlags
  completedWork.childLanes = newChildLanes

  return didBailout
}
function updateHostComponent(
  current: Fiber,
  workInProgress: Fiber,
  type: Type,
  newProps: Props,
) {
  // If we have an alternate, that means this is an update and we need to
  // schedule a side-effect to do the updates.
  const oldProps = current.memoizedProps
  if (oldProps === newProps) {
    // In mutation mode, this is sufficient for a bailout because
    // we won't touch this node even if children changed.
    return
  }

  // If we get updated because one of our children updated, we don't
  // have newProps so we'll have to reuse them.
  // TODO: Split the update API as separate for the props vs. children.
  // Even better would be if children weren't special cased at all tho.
  const instance: Instance = workInProgress.stateNode
  // TODO: Experiencing an error where oldProps is null. Suggests a host
  // component is hitting the resume path. Figure out why. Possibly
  // related to `hidden`.
  const updatePayload = prepareUpdate(instance, type, oldProps, newProps)
  // TODO: Type this specific to this type of component.
  workInProgress.updateQueue = updatePayload as any
  // If the update payload indicates that there is a change or if there
  // is a new ref we mark this as an update. All the work is done in commitWork.
  if (updatePayload) {
    markUpdate(workInProgress)
  }
}

function updateHostText(
  current: Fiber,
  workInProgress: Fiber,
  oldText: string,
  newText: string,
) {
  // If the text differs, mark it as an update. All the work in done in commitWork.
  if (oldText !== newText) {
    markUpdate(workInProgress)
  }
}

function appendAllChildren(parent: Instance, workInProgress: Fiber) {
  // We only have the top Fiber that was created but we need recurse down its
  // children to find all the terminal nodes.
  let node = workInProgress.child
  while (node !== null) {
    if (node.tag === HostComponent || node.tag === HostText) {
      appendInitialChild(parent, node.stateNode)
    } else if (node.child !== null) {
      node.child.return = node
      node = node.child
      continue
    }
    if (node === workInProgress) {
      return
    }
    while (node.sibling === null) {
      // x-todo： node.return === null ?
      if (node.return === null || node.return === workInProgress) {
        return
      }
      node = node.return
    }
    node.sibling.return = node.return
    node = node.sibling
  }
}
