import type { ReactElement } from "react"
import { REACT_ELEMENT_TYPE } from "shared/ReactSymbols"
import type { Lanes } from "./ReactFiberLane"
import type { Fiber } from "./ReactInternalTypes"
import { HostText } from "./ReactWorkTags"
import { Placement, ChildDeletion } from "./ReactFiberFlags"
import {
  createWorkInProgress,
  createFiberFromElement,
  createFiberFromText,
} from "./ReactFiber"

function ChildReconciler(shouldTrackSideEffects: boolean) {
  // 收集删除的子组件. 并标记 fiber
  function deleteChild(returnFiber: Fiber, childToDelete: Fiber): void {
    if (!shouldTrackSideEffects) {
      // Noop.
      return
    }
    const { deletions } = returnFiber
    if (deletions === null) {
      returnFiber.deletions = [childToDelete]
      returnFiber.flags |= ChildDeletion
    } else {
      deletions.push(childToDelete)
    }
  }

  function deleteRemainingChildren(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
  ): null {
    if (!shouldTrackSideEffects) {
      // Noop.
      return null
    }

    // TODO: For the shouldClone case, this could be micro-optimized a bit by
    // assuming that after the first child we've already added everything.
    let childToDelete = currentFirstChild
    while (childToDelete !== null) {
      deleteChild(returnFiber, childToDelete)
      childToDelete = childToDelete.sibling
    }
    return null
  }

  function mapRemainingChildren(
    returnFiber: Fiber,
    currentFirstChild: Fiber,
  ): Map<string | number, Fiber> {
    // Add the remaining children to a temporary map so that we can find them by
    // keys quickly. Implicit (null) keys get added to this set with their index
    // instead.
    const existingChildren: Map<string | number, Fiber> = new Map()

    let existingChild = currentFirstChild
    while (existingChild !== null) {
      if (existingChild.key !== null) {
        existingChildren.set(existingChild.key, existingChild)
      } else {
        existingChildren.set(existingChild.index, existingChild)
      }
      existingChild = existingChild.sibling as any
    }
    return existingChildren
  }

  function useFiber(fiber: Fiber, pendingProps: unknown): Fiber {
    // We currently set sibling to null and index to 0 here because it is easy
    // to forget to do before returning it. E.g. for the single child case.
    const clone = createWorkInProgress(fiber, pendingProps)
    clone.index = 0
    clone.sibling = null
    return clone
  }

  function placeChild(
    newFiber: Fiber,
    lastPlacedIndex: number,
    newIndex: number,
  ): number {
    newFiber.index = newIndex
    if (!shouldTrackSideEffects) {
      return lastPlacedIndex
    }
    const current = newFiber.alternate
    if (current !== null) {
      const oldIndex = current.index
      if (oldIndex < lastPlacedIndex) {
        // This is a move.
        // 向右移动了
        newFiber.flags |= Placement
        return lastPlacedIndex
      }
      // This item can stay in place.
      return oldIndex
    }
    // This is an insertion.
    newFiber.flags |= Placement
    return lastPlacedIndex
  }

  function placeSingleChild(newFiber: Fiber): Fiber {
    // This is simpler for the single child case. We only need to do a
    // placement for inserting new children.
    if (shouldTrackSideEffects && newFiber.alternate === null) {
      newFiber.flags |= Placement
    }
    return newFiber
  }

  function updateTextNode(
    returnFiber: Fiber,
    current: Fiber | null,
    textContent: string,
    lanes: Lanes,
  ) {
    if (current === null || current.tag !== HostText) {
      // Insert
      const created = createFiberFromText(textContent, returnFiber.mode, lanes)
      created.return = returnFiber
      return created
    }
    // Update
    const existing = useFiber(current, textContent)
    existing.return = returnFiber
    return existing
  }

  function updateElement(
    returnFiber: Fiber,
    current: Fiber | null,
    element: ReactElement,
    lanes: Lanes,
  ): Fiber {
    const elementType = element.type
    if (current !== null) {
      if (current.elementType === elementType) {
        // Move based on index
        const existing = useFiber(current, element.props)
        existing.return = returnFiber
        return existing
      }
    }
    // Insert
    const created = createFiberFromElement(element, returnFiber.mode, lanes)
    created.return = returnFiber
    return created
  }

  function createChild(
    returnFiber: Fiber,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    if (
      (typeof newChild === "string" && newChild !== "") ||
      typeof newChild === "number"
    ) {
      // Text nodes don't have keys. If the previous node is implicitly keyed
      // we can continue to replace it without aborting even if it is not a text
      // node.
      const created = createFiberFromText(
        `${newChild}`,
        returnFiber.mode,
        lanes,
      )
      created.return = returnFiber
      return created
    }

    if (typeof newChild === "object" && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          const created = createFiberFromElement(
            newChild,
            returnFiber.mode,
            lanes,
          )
          created.return = returnFiber
          return created
        }
        default:
      }
    }

    return null
  }

  function updateSlot(
    returnFiber: Fiber,
    oldFiber: Fiber | null,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    // Update the fiber if the keys match, otherwise return null.

    const key = oldFiber !== null ? oldFiber.key : null

    if (
      (typeof newChild === "string" && newChild !== "") ||
      typeof newChild === "number"
    ) {
      // Text nodes don't have keys. If the previous node is implicitly keyed
      // we can continue to replace it without aborting even if it is not a text
      // node.
      if (key !== null) {
        return null
      }
      return updateTextNode(returnFiber, oldFiber, `${newChild}`, lanes)
    }

    if (typeof newChild === "object" && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          if (newChild.key === key) {
            return updateElement(returnFiber, oldFiber, newChild, lanes)
          }
          return null
        }
        default:
      }

      if (Array.isArray(newChild)) {
        if (key !== null) {
          return null
        }
      }
    }
    return null
  }

  function updateFromMap(
    existingChildren: Map<string | number, Fiber>,
    returnFiber: Fiber,
    newIdx: number,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    if (
      (typeof newChild === "string" && newChild !== "") ||
      typeof newChild === "number"
    ) {
      // Text nodes don't have keys, so we neither have to check the old nor
      // new node for the key. If both are text nodes, they match.
      const matchedFiber = existingChildren.get(newIdx) || null
      return updateTextNode(returnFiber, matchedFiber, `${newChild}`, lanes)
    }

    if (typeof newChild === "object" && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE: {
          const matchedFiber =
            existingChildren.get(
              newChild.key === null ? newIdx : newChild.key,
            ) || null
          return updateElement(returnFiber, matchedFiber, newChild, lanes)
        }
        default:
      }
    }
    return null
  }

  // O(n) 的启发式算法
  // 1. 不考虑跨层级的元素移动，即只会比较同一层级的元素。
  // 2. 当某个元素类型发生变化时直接卸载，包括其子元素，生成新的树。
  // 3. 在同一层级使用 key 属性标识哪些子元素在不同的渲染中可能是不变的。
  // 在遍历 newChildren 时，当更早的遍历到在 oldChildren 中更靠后的元素时，那么说明该元素向左移动了，
  // 同理可得当更晚的遍历到在 oldChildren 中更靠前的元素时，该元素向右移动了。React 就采用了后者。
  // 新增和移动的 fiber，都将标记为 Placement，删除遍历过程中未匹配到的 oldFiber
  function reconcileChildrenArray(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChildren: Array<any>,
    lanes: Lanes,
  ): Fiber | null {
    // This algorithm can't optimize by searching from both ends since we
    // don't have backpointers on fibers. I'm trying to see how far we can get
    // with that model. If it ends up not being worth the tradeoffs, we can
    // add it later.

    // Even with a two ended optimization, we'd want to optimize for the case
    // where there are few changes and brute force the comparison instead of
    // going for the Map. It'd like to explore hitting that path first in
    // forward-only mode and only go for the Map once we notice that we need
    // lots of look ahead. This doesn't handle reversal as well as two ended
    // search but that's unusual. Besides, for the two ended optimization to
    // work on Iterables, we'd need to copy the whole set.

    // In this first iteration, we'll just live with hitting the bad case
    // (adding everything to a Map) in for every insert/move.

    // If you change this code, also update reconcileChildrenIterator() which
    // uses the same algorithm.

    // newChildren 中第一个子 fiber
    let resultingFirstChild: Fiber | null = null

    // newChildren[newIdx -1] 的 fiber
    // 作用：1.判断是否为链表头部找出第一个子 fiber，
    // 2.previousNewFiber.sibling = newFiber, 串联 newFiber 链表。
    let previousNewFiber: Fiber | null = null

    let oldFiber = currentFirstChild

    // 实际表示已遍历的 oldChilren 中最大的 index
    let lastPlacedIndex = 0

    // 遍历 newChildren 的索引
    let newIdx = 0
    let nextOldFiber = null
    for (; oldFiber !== null && newIdx < newChildren.length; newIdx++) {
      // 什么情况下 oldFiber.index 会大于 newIdx ?
      // 例如：oldChildren 中 存在 null、undefined、boolean 值
      if (oldFiber.index > newIdx) {
        nextOldFiber = oldFiber
        oldFiber = null
      } else {
        nextOldFiber = oldFiber.sibling
      }

      // key 不同返回 null
      const newFiber = updateSlot(
        returnFiber,
        oldFiber,
        newChildren[newIdx],
        lanes,
      )
      if (newFiber === null) {
        // TODO: This breaks on empty slots like null children. That's
        // unfortunate because it triggers the slow path all the time. We need
        // a better way to communicate whether this was a miss or null,
        // boolean, undefined, etc.
        if (oldFiber === null) {
          oldFiber = nextOldFiber
        }
        break
      }
      if (shouldTrackSideEffects) {
        if (oldFiber && newFiber.alternate === null) {
          // key 相同 elementType 不同
          // We matched the slot, but we didn't reuse the existing fiber, so we
          // need to delete the existing child.
          deleteChild(returnFiber, oldFiber)
        }
      }
      lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx)
      if (previousNewFiber === null) {
        // TODO: Move out of the loop. This only happens for the first run.
        resultingFirstChild = newFiber
      } else {
        // TODO: Defer siblings if we're not at the right index for this slot.
        // I.e. if we had null values before, then we want to defer this
        // for each null value. However, we also don't want to call updateSlot
        // with the previous one.
        previousNewFiber.sibling = newFiber
      }
      previousNewFiber = newFiber
      oldFiber = nextOldFiber
    }

    // 当 newChildren 完全遍历结束后， 删除多余的 oldFiber
    if (newIdx === newChildren.length) {
      // We've reached the end of the new children. We can delete the rest.
      deleteRemainingChildren(returnFiber, oldFiber)

      return resultingFirstChild
    }

    if (oldFiber === null) {
      // 在没有发生移动的情况下，处理新增的 reactElement
      // If we don't have any more existing children we can choose a fast path
      // since the rest will all be insertions.
      for (; newIdx < newChildren.length; newIdx++) {
        const newFiber = createChild(returnFiber, newChildren[newIdx], lanes)
        if (newFiber === null) {
          continue
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx)
        if (previousNewFiber === null) {
          // TODO: Move out of the loop. This only happens for the first run.
          resultingFirstChild = newFiber
        } else {
          previousNewFiber.sibling = newFiber
        }
        previousNewFiber = newFiber
      }

      return resultingFirstChild
    }

    // Add all children to a key map for quick lookups.
    const existingChildren = mapRemainingChildren(returnFiber, oldFiber)

    // Keep scanning and use the map to restore deleted items as moves.
    for (; newIdx < newChildren.length; newIdx++) {
      const newFiber = updateFromMap(
        existingChildren,
        returnFiber,
        newIdx,
        newChildren[newIdx],
        lanes,
      )
      if (newFiber !== null) {
        if (shouldTrackSideEffects) {
          if (newFiber.alternate !== null) {
            // The new fiber is a work in progress, but if there exists a
            // current, that means that we reused the fiber. We need to delete
            // it from the child list so that we don't add it to the deletion
            // list.
            existingChildren.delete(
              newFiber.key === null ? newIdx : newFiber.key,
            )
          }
        }
        lastPlacedIndex = placeChild(newFiber, lastPlacedIndex, newIdx)
        if (previousNewFiber === null) {
          resultingFirstChild = newFiber
        } else {
          previousNewFiber.sibling = newFiber
        }
        previousNewFiber = newFiber
      }
    }

    if (shouldTrackSideEffects) {
      // Any existing children that weren't consumed above were deleted. We need
      // to add them to the deletion list.
      existingChildren.forEach((child) => deleteChild(returnFiber, child))
    }

    return resultingFirstChild
  }

  function reconcileSingleTextNode(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    textContent: string,
    lanes: Lanes,
  ): Fiber {
    // There's no need to check for keys on text nodes since we don't have a
    // way to define them.
    if (currentFirstChild !== null && currentFirstChild.tag === HostText) {
      // We already have an existing node so let's just update it and delete
      // the rest.
      deleteRemainingChildren(returnFiber, currentFirstChild.sibling)
      const existing = useFiber(currentFirstChild, textContent)
      existing.return = returnFiber
      return existing
    }
    // The existing first child is not a text node so we need to create one
    // and delete the existing ones.
    deleteRemainingChildren(returnFiber, currentFirstChild)
    const created = createFiberFromText(textContent, returnFiber.mode, lanes)
    created.return = returnFiber
    return created
  }

  // 单个元素. 遍历 currentReturnFiber 的 children，首先查找出 key 相同 的 fiber，然后判读 fiber 与
  // reactElement 两者的类型
  // 1. Fragment 类型的 ReactElement，可通过 ReactElement.type 鉴别类型. Fragment 类型的 Fiber，其 type 以
  // 及 elementType 都为 null，只能通过 tag 来鉴别其类型. 因此判断 current fiber 与 ReactElement
  // 都为 Fragment 类型的条件是 ReactElement.type === REACT_FRAGMENT_TYPE && fiber.tag === Fragment
  // 2. Lazy 类型 （TODO)
  // 3. 其它类型的 ReactElement，则判断 element.type === fiber.element
  // key 与类型完全相同，则复用 fiber.alternate，否则创建新的 fiber，newFiber 不存在 alternate
  function reconcileSingleElement(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    element: ReactElement<any, any>,
    lanes: Lanes,
  ): Fiber {
    const { key } = element
    let child = currentFirstChild
    while (child !== null) {
      // TODO: If key === null and child.key === null, then this only applies to
      // the first item in the list.
      if (child.key === key) {
        const elementType = element.type
        if (child.elementType === elementType) {
          deleteRemainingChildren(returnFiber, child.sibling)
          const existing = useFiber(child, element.props)
          existing.return = returnFiber
          return existing
        }
        // Didn't match.
        deleteRemainingChildren(returnFiber, child)
        break
      } else {
        deleteChild(returnFiber, child)
      }
      child = child.sibling
    }

    const created = createFiberFromElement(element, returnFiber.mode, lanes)
    created.return = returnFiber
    return created
  }

  // This API will tag the children with the side-effect of the reconciliation
  // itself. They will be added to the side-effect list as we pass through the
  // children and the parent.
  function reconcileChildFibers(
    returnFiber: Fiber,
    currentFirstChild: Fiber | null,
    newChild: any,
    lanes: Lanes,
  ): Fiber | null {
    if (typeof newChild === "object" && newChild !== null) {
      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE:
          return placeSingleChild(
            reconcileSingleElement(
              returnFiber,
              currentFirstChild,
              newChild,
              lanes,
            ),
          )
        default:
      }

      if (Array.isArray(newChild)) {
        return reconcileChildrenArray(
          returnFiber,
          currentFirstChild,
          newChild,
          lanes,
        )
      }
    }

    // 处理 string、number
    // x-todo: 在 updateHostComponent 已经处理了单个字符串或数字的子元素。应该不会在这里处理吧？
    // 如果子元素为多个，那么将会在 reconcileChildrenArray 中生成 textNodeFiber
    if (
      (typeof newChild === "string" && newChild !== "") ||
      typeof newChild === "number"
    ) {
      return placeSingleChild(
        reconcileSingleTextNode(
          returnFiber,
          currentFirstChild,
          `${newChild}`,
          lanes,
        ),
      )
    }

    // Remaining cases are all treated as empty.
    // null、undefined、‘’、boolean 视为空
    return deleteRemainingChildren(returnFiber, currentFirstChild)
  }

  return reconcileChildFibers
}

export const reconcileChildFibers = ChildReconciler(true)
export const mountChildFibers = ChildReconciler(false)
