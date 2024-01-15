import type { ReactNodeList } from "shared/ReactTypes"
import type { RootTag } from "./ReactRootTags"
import type { Fiber, FiberRoot } from "./ReactInternalTypes"
import { NoLane, NoLanes, createLaneMap } from "./ReactFiberLane"
import { createHostRootFiber } from "./ReactFiber"
import { initializeUpdateQueue } from "./ReactFiberClassUpdateQueue"

export type RootState = {
  element: any
}

function FiberRootNode(this: FiberRoot, containerInfo: any, tag: RootTag) {
  this.tag = tag
  this.containerInfo = containerInfo
  this.pendingChildren = null
  this.current = null as unknown as Fiber
  this.finishedWork = null
  this.callbackNode = null
  this.callbackPriority = NoLane
  this.eventTimes = createLaneMap(NoLanes)

  this.pendingLanes = NoLanes
  this.expiredLanes = NoLanes
}

export function createFiberRoot(
  containerInfo: any,
  tag: RootTag,
  initialChildren: ReactNodeList,
): FiberRoot {
  const root: FiberRoot = new (FiberRootNode as any)(containerInfo, tag)

  // Cyclic construction. This cheats the type system right now because
  // stateNode is any.
  const uninitializedFiber = createHostRootFiber(tag)

  // 初次挂载时创建了 FiberRoot 和 RootFiber, RootFiber 作为 initialChildren 的父组件
  root.current = uninitializedFiber
  uninitializedFiber.stateNode = root

  const initialState: RootState = {
    element: initialChildren,
  }

  uninitializedFiber.memoizedState = initialState

  // TODO: 这里好像无法与 hooks 共用一套更新逻辑
  initializeUpdateQueue(uninitializedFiber)

  return root
}
