import type { ReactNodeList } from "shared/ReactTypes"
import type { Container } from "./ReactFiberHostConfig"
import type { RootTag } from "./ReactRootTags"
import type { Lane } from "./ReactFiberLane"
import type { FiberRoot } from "./ReactInternalTypes"
import { createFiberRoot } from "./ReactFiberRoot"
import {
  requestEventTime,
  requestUpdateLane,
  scheduleUpdateOnFiber,
} from "./ReactFiberWorkLoop"
import { createUpdate, enqueueUpdate } from "./ReactFiberClassUpdateQueue"

type OpaqueRoot = FiberRoot

export function createContainer(
  containerInfo: Container,
  tag: RootTag,
): OpaqueRoot {
  return createFiberRoot(containerInfo, tag, null)
}

export function updateContainer(
  element: ReactNodeList,
  container: OpaqueRoot,
): Lane {
  const { current } = container
  const eventTime = requestEventTime()
  const lane = requestUpdateLane(current)

  const update = createUpdate(eventTime, lane)

  update.payload = { element }

  const root = enqueueUpdate(current, update, lane)
  if (root !== null) {
    scheduleUpdateOnFiber(root, current, lane, eventTime)
  }

  return lane
}
