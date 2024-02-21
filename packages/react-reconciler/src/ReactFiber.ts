import type { ReactElement } from "react"
import { REACT_MEMO_TYPE } from "shared/ReactSymbols"
import type { RootTag } from "./ReactRootTags"
import type { Fiber } from "./ReactInternalTypes"
import type { WorkTag } from "./ReactWorkTags"
import type { TypeOfMode } from "./ReactTypeOfMode"
import type { Lanes } from "./ReactFiberLane"
import { ConcurrentRoot } from "./ReactRootTags"
import { NoLanes } from "./ReactFiberLane"
import { NoMode, ConcurrentMode } from "./ReactTypeOfMode"
import {
  HostRoot,
  HostComponent,
  HostText,
  FunctionComponent,
  MemoComponent,
} from "./ReactWorkTags"
import { NoFlags, StaticMask } from "./ReactFiberFlags"

function FiberNode(
  this: Fiber,
  tag: WorkTag,
  pendingProps: unknown,
  key: null | string,
  mode: TypeOfMode,
) {
  // Instance
  this.tag = tag
  this.key = key
  this.elementType = null
  this.type = null
  this.stateNode = null

  // Fiber
  this.return = null
  this.child = null
  this.sibling = null
  this.index = 0

  this.ref = null

  this.pendingProps = pendingProps
  this.memoizedProps = null
  this.updateQueue = null
  this.memoizedState = null

  this.mode = mode

  // Effects
  this.flags = NoFlags
  this.subtreeFlags = NoFlags
  this.deletions = null

  this.lanes = NoLanes
  this.childLanes = NoLanes

  this.alternate = null
}

function createFiber(
  tag: WorkTag,
  pendingProps: unknown,
  key: null | string,
  mode: TypeOfMode,
): Fiber {
  return new (FiberNode as any)(tag, pendingProps, key, mode)
}

export function createHostRootFiber(tag: RootTag): Fiber {
  let mode
  if (tag === ConcurrentRoot) {
    mode = ConcurrentMode
  } else {
    mode = NoMode
  }

  return createFiber(HostRoot, null, null, mode)
}

// This is used to create an alternate fiber to do work on.
export function createWorkInProgress(current: Fiber, pendingProps: any): Fiber {
  let workInProgress = current.alternate
  if (workInProgress === null) {
    // We use a double buffering pooling technique because we know that we'll
    // only ever need at most two versions of a tree. We pool the "other" unused
    // node that we're free to reuse. This is lazily created to avoid allocating
    // extra objects for things that are never updated. It also allow us to
    // reclaim the extra memory if needed.
    workInProgress = createFiber(
      current.tag,
      pendingProps,
      current.key,
      current.mode,
    )
    workInProgress.elementType = current.elementType
    workInProgress.type = current.type
    workInProgress.stateNode = current.stateNode

    workInProgress.alternate = current
    current.alternate = workInProgress
  } else {
    workInProgress.pendingProps = pendingProps
    // Needed because Blocks store data on type.
    workInProgress.type = current.type

    // We already have an alternate.
    // Reset the effect tag.
    workInProgress.flags = NoFlags

    // The effects are no longer valid.
    workInProgress.subtreeFlags = NoFlags
    workInProgress.deletions = null
  }

  // Reset all effects except static ones.
  // Static effects are not specific to a render.
  workInProgress.flags = current.flags & StaticMask
  workInProgress.childLanes = current.childLanes
  workInProgress.lanes = current.lanes

  workInProgress.child = current.child
  workInProgress.memoizedProps = current.memoizedProps
  workInProgress.memoizedState = current.memoizedState
  workInProgress.updateQueue = current.updateQueue

  workInProgress.sibling = current.sibling
  workInProgress.index = current.index
  workInProgress.ref = current.ref

  return workInProgress
}

export function createFiberFromElement(
  element: ReactElement,
  mode: TypeOfMode,
  lanes: Lanes,
): Fiber {
  const { type, key } = element
  const pendingProps = element.props
  const fiber = createFiberFromTypeAndProps(
    type,
    key,
    pendingProps,
    null,
    mode,
    lanes,
  )
  return fiber
}

export function createFiberFromTypeAndProps(
  type: any, // React$ElementType
  key: null | string,
  pendingProps: any,
  owner: null | Fiber,
  mode: TypeOfMode,
  lanes: Lanes,
): Fiber {
  let fiberTag: WorkTag = FunctionComponent
  // The resolved type is set if we know what the final type will be. I.e. it's not lazy.
  const resolvedType = type
  if (typeof type === "string") {
    fiberTag = HostComponent
  } else if (typeof type === "object" && type !== null) {
    switch (type.$$typeof) {
      case REACT_MEMO_TYPE:
        fiberTag = MemoComponent
        break
      default:
        throw new Error(`Error: unknown element type ${type}`)
    }
  }

  const fiber = createFiber(fiberTag, pendingProps, key, mode)
  // ReactElement.type: 函数式组件为函数， HostComponent 为  字符串， MemoComponent 为 Object($$typeof REACT_MEMO_TYPE)
  // HostText 不再这里创建
  fiber.elementType = type

  // 通常情况下 type === elementType. Lazy、Fragment 为 null
  fiber.type = resolvedType
  fiber.lanes = lanes

  return fiber
}

export function createFiberFromText(
  content: string,
  mode: TypeOfMode,
  lanes: Lanes,
): Fiber {
  const fiber = createFiber(HostText, content, null, mode)
  fiber.lanes = lanes
  return fiber
}
