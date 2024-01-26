import type { FiberRoot, Fiber } from "./ReactInternalTypes"
import type { Lanes } from "./ReactFiberLane"

import type { HookFlags } from "./ReactHookEffectTags"
import type { FunctionComponentUpdateQueue } from "./ReactFiberHooks"
import {
  FunctionComponent,
  HostRoot,
  HostComponent,
  HostText,
} from "./ReactWorkTags"
import {
  ContentReset,
  Placement,
  Update,
  MutationMask,
  Ref,
  ChildDeletion,
  NoFlags,
  PassiveMask,
  Passive,
  LayoutMask,
} from "./ReactFiberFlags"
import {
  resetTextContent,
  commitTextUpdate,
  removeChildFromContainer,
  removeChild,
  commitUpdate,
  appendChild,
  insertBefore,
  insertInContainerBefore,
  appendChildToContainer,
  detachDeletedInstance,
} from "./ReactFiberHostConfig"
import type {
  Instance,
  UpdatePayload,
  TextInstance,
  Container,
} from "./ReactFiberHostConfig"
import {
  Passive as HookPassive,
  HasEffect as HookHasEffect,
  NoFlags as NoHookEffect,
  Layout as HookLayout,
} from "./ReactHookEffectTags"

// These are tracked on the stack as we recursively traverse a
// deleted subtree.
// TODO: Update these during the whole mutation phase, not just during
// a deletion.
let hostParent: Instance | Container | null = null
let hostParentIsContainer: boolean = false

let nextEffect: Fiber | null = null

export function commitMutationEffects(
  root: FiberRoot,
  finishedWork: Fiber,
  committedLanes: Lanes,
) {
  commitMutationEffectsOnFiber(finishedWork, root, committedLanes)
}

// 递归
// 递的过程处理被删除的 fiber
// 归的过程处理 DOM 的插入与更新, 调用函数式组件 layoutEffect 的 destroy
function commitMutationEffectsOnFiber(
  finishedWork: Fiber,
  root: FiberRoot,
  lanes: Lanes,
) {
  const current = finishedWork.alternate
  const { flags } = finishedWork

  // The effect flag should be checked *after* we refine the type of fiber,
  // because the fiber tag is more specific. An exception is any flag related
  // to reconcilation, because those can be set on all fiber types.
  switch (finishedWork.tag) {
    case HostComponent: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes)
      commitReconciliationEffects(finishedWork)
      if (flags & Ref) {
        if (current !== null) {
          safelyDetachRef(current)
        }
      }

      // TODO: ContentReset gets cleared by the children during the commit
      // phase. This is a refactor hazard because it means we must read
      // flags the flags after `commitReconciliationEffects` has already run;
      // the order matters. We should refactor so that ContentReset does not
      // rely on mutating the flag during commit. Like by setting a flag
      // during the render phase instead.
      if (flags & ContentReset) {
        const instance: Instance = finishedWork.stateNode
        resetTextContent(instance)
      }

      if (flags & Update) {
        const instance: Instance = finishedWork.stateNode
        if (instance != null) {
          // Commit the work prepared earlier.
          const newProps = finishedWork.memoizedProps
          // For hydration we reuse the update path but we treat the oldProps
          // as the newProps. The updatePayload will contain the real change in
          // this case.
          const oldProps = current !== null ? current.memoizedProps : newProps
          const { type } = finishedWork
          // TODO: Type the updateQueue to be specific to host components.
          const updatePayload: null | UpdatePayload =
            finishedWork.updateQueue as any
          finishedWork.updateQueue = null
          if (updatePayload !== null) {
            commitUpdate(instance, updatePayload, type, oldProps, newProps)
          }
        }
      }
      return
    }
    case HostText: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes)
      commitReconciliationEffects(finishedWork)

      if (flags & Update) {
        if (finishedWork.stateNode === null) {
          throw new Error(
            "This should have a text node initialized. This error is likely " +
              "caused by a bug in React. Please file an issue.",
          )
        }

        const textInstance: TextInstance = finishedWork.stateNode
        const newText: string = finishedWork.memoizedProps
        // For hydration we reuse the update path but we treat the oldProps
        // as the newProps. The updatePayload will contain the real change in
        // this case.
        const oldText: string =
          current !== null ? current.memoizedProps : newText

        commitTextUpdate(textInstance, oldText, newText)
      }
      return
    }
    case FunctionComponent:
      recursivelyTraverseMutationEffects(root, finishedWork, lanes)
      commitReconciliationEffects(finishedWork)
      if (flags & Update) {
        try {
          commitHookEffectListUnmount(
            HookLayout | HookHasEffect,
            finishedWork,
            finishedWork.return,
          )
        } catch (error) {
          /* empty */
        }
        // Layout effects are destroyed during the mutation phase so that all
        // destroy functions for all fibers are called before any create functions.
        // This prevents sibling component effects from interfering with each other,
        // e.g. a destroy function in one component should never override a ref set
        // by a create function in another component during the same commit.
      }
      break
    case HostRoot:
    default: {
      recursivelyTraverseMutationEffects(root, finishedWork, lanes)
      commitReconciliationEffects(finishedWork)
    }
  }
}

function commitReconciliationEffects(finishedWork: Fiber) {
  // Placement effects (insertions, reorders) can be scheduled on any fiber
  // type. They needs to happen after the children effects have fired, but
  // before the effects on this fiber have fired.
  const { flags } = finishedWork
  if (flags & Placement) {
    commitPlacement(finishedWork)
    // Clear the "placement" from effect tag so that we know that this is
    // inserted, before any life-cycles like componentDidMount gets called.
    // TODO: findDOMNode doesn't rely on this any more but isMounted does
    // and isMounted is deprecated anyway so we should be able to kill this.
    finishedWork.flags &= ~Placement
  }
}

function recursivelyTraverseMutationEffects(
  root: FiberRoot,
  parentFiber: Fiber,
  lanes: Lanes,
) {
  // Deletions effects can be scheduled on any fiber type. They need to happen
  // before the children effects has fired.
  // 优先进行删除操作，保证子元素(DOM)顺序的正确性
  const { deletions } = parentFiber
  if (deletions !== null) {
    for (let i = 0; i < deletions.length; i++) {
      const childToDelete = deletions[i]
      // 仅需卸载离 parentFiber 最近的子 DOM 节点
      // parentFiber 与 childToDelete 实际已不在同一 fiber tree 中
      commitDeletionEffects(root, parentFiber, childToDelete)
    }
  }

  if (parentFiber.subtreeFlags & MutationMask) {
    let { child } = parentFiber
    while (child !== null) {
      commitMutationEffectsOnFiber(child, root, lanes)
      child = child.sibling
    }
  }
}

// 找到最近的 HostParent(dom) ，递归它的所有后代 fiber
// 递的过程拆分 ref, 调用函数式组件 LayoutEffect 的 destroy，归的过程卸载最顶层的 dom 节点
// 切断 deletedFiber.return 指针以断开它与 workInProgressTree 的连接，这样可以防止事件从已断开连接的组件中冒泡。
// 此时没有清除掉 child 和 sibling 指针，它们需要用于执行 PassiveEffects
function commitDeletionEffects(
  root: FiberRoot,
  returnFiber: Fiber,
  deletedFiber: Fiber,
) {
  // We only have the top Fiber that was deleted but we need to recurse down its
  // children to find all the terminal nodes.

  // Recursively delete all host nodes from the parent, detach refs, clean
  // up mounted layout effects, and call componentWillUnmount.

  // We only need to remove the topmost host child in each branch. But then we
  // still need to keep traversing to unmount effects, refs, and cWU. TODO: We
  // could split this into two separate traversals functions, where the second
  // one doesn't include any removeChild logic. This is maybe the same
  // function as "disappearLayoutEffects" (or whatever that turns into after
  // the layout phase is refactored to use recursion).

  // Before starting, find the nearest host parent on the stack so we know
  // which instance/container to remove the children from.
  // TODO: Instead of searching up the fiber return path on every deletion, we
  // can track the nearest host component on the JS stack as we traverse the
  // tree during the commit phase. This would make insertions faster, too.
  let parent = returnFiber
  findParent: while (parent !== null) {
    switch (parent.tag) {
      case HostComponent: {
        hostParent = parent.stateNode
        hostParentIsContainer = false
        break findParent
      }
      case HostRoot: {
        hostParent = parent.stateNode.containerInfo
        hostParentIsContainer = true
        break findParent
      }
      default:
    }
    parent = parent.return as Fiber
  }
  if (hostParent === null) {
    throw new Error(
      "Expected to find a host parent. This error is likely caused by " +
        "a bug in React. Please file an issue.",
    )
  }
  commitDeletionEffectsOnFiber(root, returnFiber, deletedFiber)
  hostParent = null
  hostParentIsContainer = false

  detachFiberMutation(deletedFiber)
}

function commitDeletionEffectsOnFiber(
  finishedRoot: FiberRoot,
  nearestMountedAncestor: Fiber,
  deletedFiber: Fiber,
) {
  // The cases in this outer switch modify the stack before they traverse
  // into their subtree. There are simpler cases in the inner switch
  // that don't modify the stack.
  switch (deletedFiber.tag) {
    // @ts-ignore
    case HostComponent:
      safelyDetachRef(deletedFiber)
    // eslint-disable-next-line no-fallthrough
    case HostText: {
      // We only need to remove the nearest host child. Set the host parent
      // to `null` on the stack to indicate that nested children don't
      // need to be removed.
      const prevHostParent = hostParent
      const prevHostParentIsContainer = hostParentIsContainer
      hostParent = null
      recursivelyTraverseDeletionEffects(
        finishedRoot,
        nearestMountedAncestor,
        deletedFiber,
      )
      hostParent = prevHostParent
      hostParentIsContainer = prevHostParentIsContainer
      if (hostParent !== null) {
        // Now that all the child effects have unmounted, we can remove the
        // node from the tree.
        if (hostParentIsContainer) {
          removeChildFromContainer(
            hostParent as Container,
            deletedFiber.stateNode as Instance | TextInstance,
          )
        } else {
          removeChild(
            hostParent as Instance,
            deletedFiber.stateNode as Instance | TextInstance,
          )
        }
      }
      return
    }
    case FunctionComponent:
      // eslint-disable-next-line no-case-declarations
      const updateQueue: FunctionComponentUpdateQueue | null =
        deletedFiber.updateQueue as any
      if (updateQueue !== null) {
        const { lastEffect } = updateQueue
        if (lastEffect !== null) {
          const firstEffect = lastEffect.next
          let effect = firstEffect
          do {
            const { destroy, tag } = effect
            if (destroy !== undefined && (tag & HookLayout) !== NoHookEffect) {
              safelyCallDestroy(deletedFiber, nearestMountedAncestor, destroy)
            }
            effect = effect.next
          } while (effect !== firstEffect)
        }
      }

      recursivelyTraverseDeletionEffects(
        finishedRoot,
        nearestMountedAncestor,
        deletedFiber,
      )
      break
    default: {
      recursivelyTraverseDeletionEffects(
        finishedRoot,
        nearestMountedAncestor,
        deletedFiber,
      )
    }
  }
}

function recursivelyTraverseDeletionEffects(
  finishedRoot: FiberRoot,
  nearestMountedAncestor: Fiber,
  parent: Fiber,
) {
  // TODO: Use a static flag to skip trees that don't have unmount effects
  let { child } = parent
  while (child !== null) {
    commitDeletionEffectsOnFiber(finishedRoot, nearestMountedAncestor, child)
    child = child.sibling
  }
}

function detachFiberMutation(fiber: Fiber) {
  // Cut off the return pointer to disconnect it from the tree.
  // This enables us to detect and warn against state updates on an unmounted component.
  // It also prevents events from bubbling from within disconnected components.
  //
  // Ideally, we should also clear the child pointer of the parent alternate to let this
  // get GC:ed but we don't know which for sure which parent is the current
  // one so we'll settle for GC:ing the subtree of this child.
  // This child itself will be GC:ed when the parent updates the next time.
  //
  // Note that we can't clear child or sibling pointers yet.
  // They're needed for passive effects and for findDOMNode.
  // We defer those fields, and all other cleanup, to the passive phase (see detachFiberAfterEffects).
  //
  // Don't reset the alternate yet, either. We need that so we can detach the
  // alternate's fields in the passive phase. Clearing the return pointer is
  // sufficient for findDOMNode semantics.
  const { alternate } = fiber
  if (alternate !== null) {
    alternate.return = null
  }
  fiber.return = null
}

function commitPlacement(finishedWork: Fiber): void {
  // Recursively insert all host nodes into the parent.
  const parentFiber = getHostParentFiber(finishedWork)

  // Note: these two variables *must* always be updated together.
  switch (parentFiber.tag) {
    case HostComponent: {
      const parent: Instance = parentFiber.stateNode
      if (parentFiber.flags & ContentReset) {
        // Reset the text content of the parent before doing any insertions
        resetTextContent(parent)
        // Clear ContentReset from the effect tag
        parentFiber.flags &= ~ContentReset
      }

      const before = getHostSibling(finishedWork)
      // We only have the top Fiber that was inserted but we need to recurse down its
      // children to find all the terminal nodes.
      insertOrAppendPlacementNode(finishedWork, before, parent)
      break
    }
    case HostRoot: {
      const parent: Container = parentFiber.stateNode.containerInfo
      const before = getHostSibling(finishedWork)
      insertOrAppendPlacementNodeIntoContainer(finishedWork, before, parent)
      break
    }
    // eslint-disable-next-line-no-fallthrough
    default:
      throw new Error(
        "Invalid host parent fiber. This error is likely caused by a bug " +
          "in React. Please file an issue.",
      )
  }
}

function getHostParentFiber(fiber: Fiber): Fiber {
  let parent = fiber.return
  while (parent !== null) {
    if (isHostParent(parent)) {
      return parent
    }
    parent = parent.return
  }

  throw new Error(
    "Expected to find a host parent. This error is likely caused by a bug " +
      "in React. Please file an issue.",
  )
}

function isHostParent(fiber: Fiber): boolean {
  return fiber.tag === HostComponent || fiber.tag === HostRoot
}

function getHostSibling(fiber: Fiber): Instance | null {
  // We're going to search forward into the tree until we find a sibling host
  // node. Unfortunately, if multiple insertions are done in a row we have to
  // search past them. This leads to exponential search for the next sibling.
  // TODO: Find a more efficient way to do this.
  let node: Fiber = fiber
  siblings: while (true) {
    // If we didn't find anything, let's try the next sibling.
    while (node.sibling === null) {
      if (node.return === null || isHostParent(node.return)) {
        // If we pop out of the root or hit the parent the fiber we are the
        // last sibling.
        return null
      }
      node = node.return
    }
    node.sibling.return = node.return
    node = node.sibling
    while (node.tag !== HostComponent && node.tag !== HostText) {
      // If it is not host node and, we might have a host node inside it.
      // Try to search down until we find one.
      if (node.flags & Placement) {
        // 跳过该 fiber, 该 fiber 还未插入到 DOM 中
        // If we don't have a child, try the siblings instead.
        continue siblings
      }
      // If we don't have a child, try the siblings instead.
      // We also skip portals because they are not part of this host tree.
      if (node.child === null) {
        continue siblings
      } else {
        node.child.return = node
        node = node.child
      }
    }
    // Check if this host node is stable or about to be placed.
    if (!(node.flags & Placement)) {
      // Found it!
      return node.stateNode
    }
  }
}

function insertOrAppendPlacementNode(
  node: Fiber,
  before: Instance | null,
  parent: Instance,
): void {
  const { tag } = node
  const isHost = tag === HostComponent || tag === HostText
  if (isHost) {
    const { stateNode } = node
    if (before) {
      insertBefore(parent, stateNode, before)
    } else {
      appendChild(parent, stateNode)
    }
  } else {
    // 需要将该 fiber 的所有子代 DOM 节点插入到 parent 中
    const { child } = node
    if (child !== null) {
      insertOrAppendPlacementNode(child, before, parent)
      let { sibling } = child
      while (sibling !== null) {
        insertOrAppendPlacementNode(sibling, before, parent)
        sibling = sibling.sibling
      }
    }
  }
}

function insertOrAppendPlacementNodeIntoContainer(
  node: Fiber,
  before: Instance | null,
  parent: Container,
): void {
  const { tag } = node
  const isHost = tag === HostComponent || tag === HostText
  if (isHost) {
    const { stateNode } = node
    if (before) {
      insertInContainerBefore(parent, stateNode, before)
    } else {
      appendChildToContainer(parent, stateNode)
    }
  } else {
    const { child } = node
    if (child !== null) {
      insertOrAppendPlacementNodeIntoContainer(child, before, parent)
      let { sibling } = child
      while (sibling !== null) {
        insertOrAppendPlacementNodeIntoContainer(sibling, before, parent)
        sibling = sibling.sibling
      }
    }
  }
}

function safelyDetachRef(current: Fiber) {
  const { ref } = current
  if (ref !== null) {
    if (typeof ref === "function") {
      try {
        ref(null)
      } catch (error) {
        /* empty */
      }
    } else {
      ref.current = null
    }
  }
}

function safelyAttachRef(current: Fiber) {
  try {
    commitAttachRef(current)
  } catch (error) {
    /* empty */
  }
}

function commitAttachRef(finishedWork: Fiber) {
  const { ref } = finishedWork
  if (ref !== null) {
    const instance = finishedWork.stateNode
    if (typeof ref === "function") {
      ref(instance)
    } else {
      ref.current = instance
    }
  }
}

export function commitPassiveUnmountEffects(firstChild: Fiber): void {
  nextEffect = firstChild
  commitPassiveUnmountEffects_begin()
}

function commitPassiveUnmountEffects_begin() {
  while (nextEffect !== null) {
    const fiber = nextEffect
    const { child } = fiber

    if ((nextEffect.flags & ChildDeletion) !== NoFlags) {
      const { deletions } = fiber
      if (deletions !== null) {
        for (let i = 0; i < deletions.length; i++) {
          const fiberToDelete = deletions[i]
          nextEffect = fiberToDelete
          commitPassiveUnmountEffectsInsideOfDeletedTree_begin(
            fiberToDelete,
            fiber,
          )
        }

        // A fiber was deleted from this parent fiber, but it's still part of
        // the previous (alternate) parent fiber's list of children. Because
        // children are a linked list, an earlier sibling that's still alive
        // will be connected to the deleted fiber via its `alternate`:
        //
        //   live fiber
        //   --alternate--> previous live fiber
        //   --sibling--> deleted fiber
        //
        // We can't disconnect `alternate` on nodes that haven't been deleted
        // yet, but we can disconnect the `sibling` and `child` pointers.
        const previousFiber = fiber.alternate
        if (previousFiber !== null) {
          let detachedChild = previousFiber.child
          if (detachedChild !== null) {
            previousFiber.child = null
            do {
              const detachedSibling = detachedChild.sibling as any
              detachedChild.sibling = null
              detachedChild = detachedSibling
            } while (detachedChild !== null)
          }
        }

        nextEffect = fiber
      }
    }

    // effects fire in child -> parent order
    // 后序遍历
    if ((fiber.subtreeFlags & PassiveMask) !== NoFlags && child !== null) {
      child.return = fiber
      nextEffect = child
    } else {
      commitPassiveUnmountEffects_complete()
    }
  }
}

function commitPassiveUnmountEffects_complete() {
  while (nextEffect !== null) {
    const fiber = nextEffect
    if ((fiber.flags & Passive) !== NoFlags) {
      commitPassiveUnmountOnFiber(fiber)
    }

    const { sibling } = fiber
    if (sibling !== null) {
      sibling.return = fiber.return
      nextEffect = sibling
      return
    }

    nextEffect = fiber.return
  }
}

// Deletion effects fire in parent -> child order
// 前序遍历
function commitPassiveUnmountEffectsInsideOfDeletedTree_begin(
  deletedSubtreeRoot: Fiber,
  nearestMountedAncestor: Fiber | null,
) {
  while (nextEffect !== null) {
    const fiber = nextEffect
    commitPassiveUnmountInsideDeletedTreeOnFiber(fiber, nearestMountedAncestor)

    const { child } = fiber
    if (child !== null) {
      nextEffect = child
    } else {
      commitPassiveUnmountEffectsInsideOfDeletedTree_complete(
        deletedSubtreeRoot,
      )
    }
  }
}

function commitPassiveUnmountEffectsInsideOfDeletedTree_complete(
  deletedSubtreeRoot: Fiber,
) {
  while (nextEffect !== null) {
    const fiber = nextEffect
    const { sibling } = fiber
    const returnFiber = fiber.return

    // Recursively traverse the entire deleted tree and clean up fiber fields.
    // This is more aggressive than ideal, and the long term goal is to only
    // have to detach the deleted tree at the root.
    detachFiberAfterEffects(fiber)
    if (fiber === deletedSubtreeRoot) {
      nextEffect = null
      return
    }

    if (sibling !== null) {
      sibling.return = returnFiber
      nextEffect = sibling
      return
    }

    nextEffect = returnFiber
  }
}

function commitPassiveUnmountInsideDeletedTreeOnFiber(
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
) {
  switch (current.tag) {
    case FunctionComponent: {
      commitHookEffectListUnmount(HookPassive, current, nearestMountedAncestor)
      break
    }
    default:
      break
  }
}

function commitPassiveUnmountOnFiber(finishedWork: Fiber): void {
  switch (finishedWork.tag) {
    case FunctionComponent: {
      commitHookEffectListUnmount(
        HookPassive | HookHasEffect,
        finishedWork,
        finishedWork.return,
      )
      break
    }
    default:
      break
  }
}

function commitHookEffectListUnmount(
  flags: HookFlags,
  finishedWork: Fiber,
  nearestMountedAncestor: Fiber | null,
) {
  const updateQueue: FunctionComponentUpdateQueue | null =
    finishedWork.updateQueue as any
  const lastEffect = updateQueue !== null ? updateQueue.lastEffect : null
  if (lastEffect !== null) {
    const firstEffect = lastEffect.next
    let effect = firstEffect

    do {
      if ((effect.tag & flags) === flags) {
        // Unmount
        const { destroy } = effect
        effect.destroy = undefined
        if (destroy !== undefined) {
          safelyCallDestroy(finishedWork, nearestMountedAncestor, destroy)
        }
      }
      effect = effect.next
    } while (effect !== firstEffect)
  }
}

function safelyCallDestroy(
  current: Fiber,
  nearestMountedAncestor: Fiber | null,
  destroy: () => void,
) {
  try {
    destroy()
  } catch (error) {
    // captureCommitPhaseError(current, nearestMountedAncestor, error)
  }
}

function detachFiberAfterEffects(fiber: Fiber) {
  const { alternate } = fiber
  if (alternate !== null) {
    fiber.alternate = null
    detachFiberAfterEffects(alternate)
  }

  // Clear cyclical Fiber fields. This level alone is designed to roughly
  // approximate the planned Fiber refactor. In that world, `setState` will be
  // bound to a special "instance" object instead of a Fiber. The Instance
  // object will not have any of these fields. It will only be connected to
  // the fiber tree via a single link at the root. So if this level alone is
  // sufficient to fix memory issues, that bodes well for our plans.
  fiber.child = null
  fiber.deletions = null
  fiber.sibling = null

  // The `stateNode` is cyclical because on host nodes it points to the host
  // tree, which has its own pointers to children, parents, and siblings.
  // The other host nodes also point back to fibers, so we should detach that
  // one, too.
  if (fiber.tag === HostComponent) {
    const hostInstance: Instance = fiber.stateNode
    if (hostInstance !== null) {
      detachDeletedInstance(hostInstance)
    }
  }
  fiber.stateNode = null

  // I'm intentionally not clearing the `return` field in this level. We
  // already disconnect the `return` pointer at the root of the deleted
  // subtree (in `detachFiberMutation`). Besides, `return` by itself is not
  // cyclical — it's only cyclical when combined with `child`, `sibling`, and
  // `alternate`. But we'll clear it in the next level anyway, just in case.

  // Theoretically, nothing in here should be necessary, because we already
  // disconnected the fiber from the tree. So even if something leaks this
  // particular fiber, it won't leak anything else
  //
  // The purpose of this branch is to be super aggressive so we can measure
  // if there's any difference in memory impact. If there is, that could
  // indicate a React leak we don't know about.
  fiber.return = null
  fiber.dependencies = null
  fiber.memoizedProps = null
  fiber.memoizedState = null
  fiber.pendingProps = null
  fiber.stateNode = null
  // TODO: Move to `commitPassiveUnmountInsideDeletedTreeOnFiber` instead.
  fiber.updateQueue = null
}

export function commitPassiveMountEffects(finishedWork: Fiber): void {
  nextEffect = finishedWork
  commitPassiveMountEffects_begin()
}

function commitPassiveMountEffects_begin() {
  // effects fire in child -> parent order
  // 后序遍历

  while (nextEffect !== null) {
    const fiber = nextEffect
    const firstChild = fiber.child
    if ((fiber.subtreeFlags & PassiveMask) !== NoFlags && firstChild !== null) {
      firstChild.return = fiber
      nextEffect = firstChild
    } else {
      commitPassiveMountEffects_complete()
    }
  }
}

function commitPassiveMountEffects_complete() {
  while (nextEffect !== null) {
    const fiber = nextEffect
    if ((fiber.flags & Passive) !== NoFlags) {
      try {
        commitPassiveMountOnFiber(fiber)
      } catch (error) {
        /* */
      }
    }

    const { sibling } = fiber
    if (sibling !== null) {
      sibling.return = fiber.return
      nextEffect = sibling
      return
    }

    nextEffect = fiber.return
  }
}

function commitPassiveMountOnFiber(finishedWork: Fiber): void {
  switch (finishedWork.tag) {
    case FunctionComponent: {
      commitHookEffectListMount(HookPassive | HookHasEffect, finishedWork)
      break
    }
    default: {
      break
    }
  }
}

function commitHookEffectListMount(flags: HookFlags, finishedWork: Fiber) {
  const updateQueue: FunctionComponentUpdateQueue | null =
    finishedWork.updateQueue as any
  const lastEffect = updateQueue !== null ? updateQueue.lastEffect : null
  if (lastEffect !== null) {
    const firstEffect = lastEffect.next
    let effect = firstEffect
    do {
      if ((effect.tag & flags) === flags) {
        // Mount
        const { create } = effect
        effect.destroy = create()
      }
      effect = effect.next
    } while (effect !== firstEffect)
  }
}

export function commitLayoutEffects(finishedWork: Fiber): void {
  nextEffect = finishedWork

  commitLayoutEffects_begin()
}

// 后序遍历 执行 LayoutEffects, 绑定 ref
// child -> parent order
function commitLayoutEffects_begin() {
  while (nextEffect !== null) {
    const fiber = nextEffect
    const firstChild = fiber.child

    if ((fiber.subtreeFlags & LayoutMask) !== NoFlags && firstChild !== null) {
      firstChild.return = fiber
      nextEffect = firstChild
    } else {
      commitLayoutMountEffects_complete()
    }
  }
}

function commitLayoutMountEffects_complete() {
  while (nextEffect !== null) {
    const fiber = nextEffect
    if ((fiber.flags & LayoutMask) !== NoFlags) {
      try {
        commitLayoutEffectOnFiber(fiber)
      } catch (error) {
        /* empty */
      }
    }

    const { sibling } = fiber
    if (sibling !== null) {
      sibling.return = fiber.return
      nextEffect = sibling
      return
    }
    nextEffect = fiber.return
  }
}

function commitLayoutEffectOnFiber(finishedWork: Fiber): void {
  if ((finishedWork.flags & LayoutMask) !== NoFlags) {
    switch (finishedWork.tag) {
      case FunctionComponent: {
        commitHookEffectListMount(HookLayout | HookHasEffect, finishedWork)
        break
      }
      case HostRoot:
      case HostComponent:
      case HostText: {
        // We have no life-cycles associated with portals.
        break
      }
      default:
        throw new Error(
          "This unit of work tag should not have side-effects. This error is " +
            "likely caused by a bug in React. Please file an issue.",
        )
    }
  }
  if (finishedWork.flags & Ref) {
    safelyAttachRef(finishedWork)
  }
}
