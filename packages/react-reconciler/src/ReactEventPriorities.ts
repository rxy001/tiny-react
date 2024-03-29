import type { Lane, Lanes } from "./ReactFiberLane"
import {
  NoLane,
  SyncLane,
  InputContinuousLane,
  DefaultLane,
  IdleLane,
  getHighestPriorityLane,
  includesNonIdleWork,
} from "./ReactFiberLane"

export type EventPriority = Lane

export const DiscreteEventPriority: EventPriority = SyncLane
export const ContinuousEventPriority: EventPriority = InputContinuousLane
export const DefaultEventPriority: EventPriority = DefaultLane
export const IdleEventPriority: EventPriority = IdleLane

let currentUpdatePriority: EventPriority = NoLane

export function getCurrentUpdatePriority(): EventPriority {
  return currentUpdatePriority
}

export function setCurrentUpdatePriority(newPriority: EventPriority) {
  currentUpdatePriority = newPriority
}

export function runWithPriority<T>(priority: EventPriority, fn: () => T): T {
  const previousPriority = currentUpdatePriority
  try {
    currentUpdatePriority = priority
    return fn()
  } finally {
    currentUpdatePriority = previousPriority
  }
}

export function higherEventPriority(
  a: EventPriority,
  b: EventPriority,
): EventPriority {
  return a !== 0 && a < b ? a : b
}

export function lowerEventPriority(
  a: EventPriority,
  b: EventPriority,
): EventPriority {
  return a === 0 || a > b ? a : b
}

export function isHigherEventPriority(
  a: EventPriority,
  b: EventPriority,
): boolean {
  return a !== 0 && a < b
}

/**
 * Converts lanes to event priority.
 *
 * @param {Lanes} lanes - The lanes to convert.
 * @return {EventPriority} 返回 lanes 最高优先级相对应的 event priority， 最低为 DefaultLane
 */
export function lanesToEventPriority(lanes: Lanes): EventPriority {
  const lane = getHighestPriorityLane(lanes)
  if (!isHigherEventPriority(DiscreteEventPriority, lane)) {
    return DiscreteEventPriority
  }
  if (!isHigherEventPriority(ContinuousEventPriority, lane)) {
    return ContinuousEventPriority
  }
  if (includesNonIdleWork(lane)) {
    return DefaultEventPriority
  }
  return IdleEventPriority
}
