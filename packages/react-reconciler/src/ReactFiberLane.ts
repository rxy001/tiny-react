import type { FiberRoot } from "./ReactInternalTypes"

// TODO: Ideally these types would be opaque but that doesn't work well with
// our reconciler fork infra, since these leak into non-reconciler packages.

export type Lanes = number
export type Lane = number
export type LaneMap<T> = Array<T>

// Lane values below should be kept in sync with getLabelForLane(), used by react-devtools-timeline.
// If those values are changed that package should be rebuilt and redeployed.

export const TotalLanes = 31

export const NoLanes: Lanes = /*                        */ 0b0000000000000000000000000000000
export const NoLane: Lane = /*                          */ 0b0000000000000000000000000000000

export const SyncLane: Lane = /*                        */ 0b0000000000000000000000000000001

export const InputContinuousHydrationLane: Lane = /*    */ 0b0000000000000000000000000000010
export const InputContinuousLane: Lane = /*             */ 0b0000000000000000000000000000100

export const DefaultHydrationLane: Lane = /*            */ 0b0000000000000000000000000001000
export const DefaultLane: Lane = /*                     */ 0b0000000000000000000000000010000

const TransitionHydrationLane: Lane = /*                */ 0b0000000000000000000000000100000
const TransitionLanes: Lanes = /*                       */ 0b0000000001111111111111111000000
const TransitionLane1: Lane = /*                        */ 0b0000000000000000000000001000000
const TransitionLane2: Lane = /*                        */ 0b0000000000000000000000010000000
const TransitionLane3: Lane = /*                        */ 0b0000000000000000000000100000000
const TransitionLane4: Lane = /*                        */ 0b0000000000000000000001000000000
const TransitionLane5: Lane = /*                        */ 0b0000000000000000000010000000000
const TransitionLane6: Lane = /*                        */ 0b0000000000000000000100000000000
const TransitionLane7: Lane = /*                        */ 0b0000000000000000001000000000000
const TransitionLane8: Lane = /*                        */ 0b0000000000000000010000000000000
const TransitionLane9: Lane = /*                        */ 0b0000000000000000100000000000000
const TransitionLane10: Lane = /*                       */ 0b0000000000000001000000000000000
const TransitionLane11: Lane = /*                       */ 0b0000000000000010000000000000000
const TransitionLane12: Lane = /*                       */ 0b0000000000000100000000000000000
const TransitionLane13: Lane = /*                       */ 0b0000000000001000000000000000000
const TransitionLane14: Lane = /*                       */ 0b0000000000010000000000000000000
const TransitionLane15: Lane = /*                       */ 0b0000000000100000000000000000000
const TransitionLane16: Lane = /*                       */ 0b0000000001000000000000000000000

const RetryLanes: Lanes = /*                            */ 0b0000111110000000000000000000000
const RetryLane1: Lane = /*                             */ 0b0000000010000000000000000000000
const RetryLane2: Lane = /*                             */ 0b0000000100000000000000000000000
const RetryLane3: Lane = /*                             */ 0b0000001000000000000000000000000
const RetryLane4: Lane = /*                             */ 0b0000010000000000000000000000000
const RetryLane5: Lane = /*                             */ 0b0000100000000000000000000000000

export const SomeRetryLane: Lane = RetryLane1

export const SelectiveHydrationLane: Lane = /*          */ 0b0001000000000000000000000000000

const NonIdleLanes: Lanes = /*                          */ 0b0001111111111111111111111111111

export const NoTimestamp = -1

export const IdleHydrationLane: Lane = /*               */ 0b0010000000000000000000000000000
export const IdleLane: Lane = /*                        */ 0b0100000000000000000000000000000

export function getHighestPriorityLane(lanes: Lanes): Lane {
  return lanes & -lanes
}

export function pickArbitraryLane(lanes: Lanes): Lane {
  // This wrapper function gets inlined. Only exists so to communicate that it
  // doesn't matter which bit is selected; you can pick any bit without
  // affecting the algorithms where its used. Here I'm using
  // getHighestPriorityLane because it requires the fewest operations.
  return getHighestPriorityLane(lanes)
}

export function includesNonIdleWork(lanes: Lanes) {
  return (lanes & NonIdleLanes) !== NoLanes
}

export function mergeLanes(a: Lanes | Lane, b: Lanes | Lane): Lanes {
  return a | b
}

function pickArbitraryLaneIndex(lanes: Lanes) {
  return 31 - Math.clz32(lanes)
}

function laneToIndex(lane: Lane) {
  return pickArbitraryLaneIndex(lane)
}

export function markRootUpdated(
  root: FiberRoot,
  updateLane: Lane,
  eventTime: number,
) {
  root.pendingLanes |= updateLane

  const { eventTimes } = root
  const index = laneToIndex(updateLane)
  // We can always overwrite an existing timestamp because we prefer the most
  // recent event, and we assume time is monotonically increasing.
  eventTimes[index] = eventTime
}

export function createLaneMap<T>(initial: T): LaneMap<T> {
  // Intentionally pushing one by one.
  // https://v8.dev/blog/elements-kinds#avoid-creating-holes
  const laneMap = []
  for (let i = 0; i < TotalLanes; i++) {
    laneMap.push(initial)
  }
  return laneMap
}

function getHighestPriorityLanes(lanes: Lanes | Lane): Lanes {
  switch (getHighestPriorityLane(lanes)) {
    case SyncLane:
      return SyncLane
    case InputContinuousHydrationLane:
      return InputContinuousHydrationLane
    case InputContinuousLane:
      return InputContinuousLane
    case DefaultHydrationLane:
      return DefaultHydrationLane
    case DefaultLane:
      return DefaultLane
    case TransitionHydrationLane:
      return TransitionHydrationLane
    case TransitionLane1:
    case TransitionLane2:
    case TransitionLane3:
    case TransitionLane4:
    case TransitionLane5:
    case TransitionLane6:
    case TransitionLane7:
    case TransitionLane8:
    case TransitionLane9:
    case TransitionLane10:
    case TransitionLane11:
    case TransitionLane12:
    case TransitionLane13:
    case TransitionLane14:
    case TransitionLane15:
    case TransitionLane16:
      return lanes & TransitionLanes
    case RetryLane1:
    case RetryLane2:
    case RetryLane3:
    case RetryLane4:
    case RetryLane5:
      return lanes & RetryLanes
    case SelectiveHydrationLane:
      return SelectiveHydrationLane
    case IdleHydrationLane:
      return IdleHydrationLane
    case IdleLane:
      return IdleLane

    default:
      // This shouldn't be reachable, but as a fallback, return the entire bitmask.
      return lanes
  }
}

function computeExpirationTime(lane: Lane, currentTime: number) {
  switch (lane) {
    case SyncLane:
    case InputContinuousHydrationLane:
    case InputContinuousLane:
      // User interactions should expire slightly more quickly.
      //
      // NOTE: This is set to the corresponding constant as in Scheduler.js.
      // When we made it larger, a product metric in www regressed, suggesting
      // there's a user interaction that's being starved by a series of
      // synchronous updates. If that theory is correct, the proper solution is
      // to fix the starvation. However, this scenario supports the idea that
      // expiration times are an important safeguard when starvation
      // does happen.
      return currentTime + 250
    case DefaultHydrationLane:
    case DefaultLane:
    case TransitionHydrationLane:
    case TransitionLane1:
    case TransitionLane2:
    case TransitionLane3:
    case TransitionLane4:
    case TransitionLane5:
    case TransitionLane6:
    case TransitionLane7:
    case TransitionLane8:
    case TransitionLane9:
    case TransitionLane10:
    case TransitionLane11:
    case TransitionLane12:
    case TransitionLane13:
    case TransitionLane14:
    case TransitionLane15:
    case TransitionLane16:
      return currentTime + 5000
    case RetryLane1:
    case RetryLane2:
    case RetryLane3:
    case RetryLane4:
    case RetryLane5:
      // TODO: Retries should be allowed to expire if they are CPU bound for
      // too long, but when I made this change it caused a spike in browser
      // crashes. There must be some other underlying bug; not super urgent but
      // ideally should figure out why and fix it. Unfortunately we don't have
      // a repro for the crashes, only detected via production metrics.
      return NoTimestamp
    case SelectiveHydrationLane:
    case IdleHydrationLane:
    case IdleLane:
    default:
      return NoTimestamp
  }
}

export function markStarvedLanesAsExpired(
  root: FiberRoot,
  currentTime: number,
): void {
  // TODO: This gets called every time we yield. We can optimize by storing
  // the earliest expiration time on the root. Then use that to quickly bail out
  // of this function.

  const { pendingLanes, expirationTimes } = root

  // Iterate through the pending lanes and check if we've reached their
  // expiration time. If so, we'll assume the update is being starved and mark
  // it as expired to force it to finish.
  let lanes = pendingLanes
  while (lanes > 0) {
    const index = pickArbitraryLaneIndex(lanes)
    const lane = 1 << index

    const expirationTime = expirationTimes[index]
    if (expirationTime === NoTimestamp) {
      // Found a pending lane with no expiration time. Compute a new expiration time
      // using the current time.

      expirationTimes[index] = computeExpirationTime(lane, currentTime)
    } else if (expirationTime <= currentTime) {
      // This lane expired
      root.expiredLanes |= lane
    }

    lanes &= ~lane
  }
}

export function getNextLanes(root: FiberRoot, _wipLanes: Lanes): Lanes {
  // Early bailout if there's no pending work left.
  const { pendingLanes } = root
  if (pendingLanes === NoLanes) {
    return NoLanes
  }

  let nextLanes = NoLanes

  const nonIdlePendingLanes = pendingLanes & NonIdleLanes
  if (nonIdlePendingLanes !== NoLanes) {
    const nonIdleUnblockedLanes = nonIdlePendingLanes
    if (nonIdleUnblockedLanes !== NoLanes) {
      nextLanes = getHighestPriorityLanes(nonIdleUnblockedLanes)
    }
  }

  if (nextLanes === NoLanes) {
    // This should only be reachable if we're suspended
    // TODO: Consider warning in this path if a fallback timer is not scheduled.
    return NoLanes
  }

  return nextLanes
}

export function includesSomeLane(a: Lanes | Lane, b: Lanes | Lane) {
  return (a & b) !== NoLanes
}

export function isSubsetOfLanes(set: Lanes, subset: Lanes | Lane) {
  return (set & subset) === subset
}

export function markRootFinished(root: FiberRoot, remainingLanes: Lanes) {
  root.pendingLanes = remainingLanes

  root.expiredLanes &= remainingLanes
}
