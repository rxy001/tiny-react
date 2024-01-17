import type { SchedulerCallback } from "./Scheduler"
import {
  getCurrentUpdatePriority,
  setCurrentUpdatePriority,
  DiscreteEventPriority,
} from "./ReactEventPriorities"

let syncQueue: Array<SchedulerCallback> | null = null

let isFlushingSyncQueue = false

export function scheduleSyncCallback(callback: SchedulerCallback) {
  // Push this callback into an internal queue. We'll flush these either in
  // the next tick, or earlier if something calls `flushSyncCallbackQueue`.
  if (syncQueue === null) {
    syncQueue = [callback]
  } else {
    // Push onto existing queue. Don't need to schedule a callback because
    // we already scheduled one when we created the queue.
    syncQueue.push(callback)
  }
}

export function flushSyncCallbacks() {
  if (!isFlushingSyncQueue && syncQueue !== null) {
    // Prevent re-entrance.
    isFlushingSyncQueue = true
    let i = 0
    const previousUpdatePriority = getCurrentUpdatePriority()

    try {
      const isSync = true
      const queue = syncQueue
      setCurrentUpdatePriority(DiscreteEventPriority)
      for (; i < queue.length; i++) {
        let callback = queue[i]
        do {
          callback = callback(isSync) as SchedulerCallback
        } while (callback !== null)
      }
      syncQueue = null
      // eslint-disable-next-line no-useless-catch
    } catch (error) {
      throw error
    } finally {
      setCurrentUpdatePriority(previousUpdatePriority)
      isFlushingSyncQueue = false
    }
  }
  return null
}
