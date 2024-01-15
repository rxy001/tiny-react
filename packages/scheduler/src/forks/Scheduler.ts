import {
  enableSchedulerDebugging,
  frameYieldMs,
} from "../SchedulerFeatureFlags"

import { push, pop, peek } from "../SchedulerMinHeap"

// TODO: Use symbols?
import {
  ImmediatePriority,
  UserBlockingPriority,
  NormalPriority,
  LowPriority,
  IdlePriority,
} from "../SchedulerPriorities"

interface Task {
  id: number
  callback: ((timeout: boolean) => void) | null
  priorityLevel: number
  startTime: number
  expirationTime: number
  sortIndex: number
}

const getCurrentTime = performance.now

// Max 31 bit integer. The max integer size in V8 for 32-bit systems.
// Math.pow(2, 30) - 1
// 0b111111111111111111111111111111
const maxSigned31BitInt = 1073741823

// Times out immediately
const IMMEDIATE_PRIORITY_TIMEOUT = -1
// Eventually times out
const USER_BLOCKING_PRIORITY_TIMEOUT = 250
const NORMAL_PRIORITY_TIMEOUT = 5000
const LOW_PRIORITY_TIMEOUT = 10000
// Never times out
const IDLE_PRIORITY_TIMEOUT = maxSigned31BitInt

// Tasks are stored on a min heap
const taskQueue: Task[] = []

// Incrementing id counter. Used to maintain insertion order.
let taskIdCounter = 1

// Pausing the scheduler is useful for debugging.
let isSchedulerPaused = false

let currentTask: Task | null = null
let currentPriorityLevel = NormalPriority

// This is set while performing work, to prevent re-entrance.
let isPerformingWork = false

let isHostCallbackScheduled = false
let isHostTimeoutScheduled = false

function flushWork(hasTimeRemaining: boolean, initialTime: number) {
  // We'll need a host callback the next time work is scheduled.
  isHostCallbackScheduled = false
  if (isHostTimeoutScheduled) {
    // We scheduled a timeout but it's no longer needed. Cancel it.
    isHostTimeoutScheduled = false
    // cancelHostTimeout()
  }

  isPerformingWork = true
  const previousPriorityLevel = currentPriorityLevel
  try {
    return workLoop(hasTimeRemaining, initialTime)
  } finally {
    currentTask = null
    currentPriorityLevel = previousPriorityLevel
    isPerformingWork = false
  }
}

function workLoop(hasTimeRemaining: boolean, initialTime: number) {
  let currentTime = initialTime
  currentTask = peek(taskQueue) as Task
  while (
    currentTask !== null &&
    !(enableSchedulerDebugging && isSchedulerPaused)
  ) {
    if (
      currentTask.expirationTime > currentTime &&
      (!hasTimeRemaining || shouldYieldToHost())
    ) {
      // This currentTask hasn't expired, and we've reached the deadline.
      break
    }
    const { callback } = currentTask
    if (typeof callback === "function") {
      currentTask.callback = null
      currentPriorityLevel = currentTask.priorityLevel
      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime

      const continuationCallback = callback(didUserCallbackTimeout)
      currentTime = getCurrentTime()
      if (typeof continuationCallback === "function") {
        currentTask.callback = continuationCallback
      } else if (currentTask === peek(taskQueue)) {
        pop(taskQueue)
      }
    } else {
      pop(taskQueue)
    }
    currentTask = peek(taskQueue) as Task
  }
  // Return whether there's additional work
  if (currentTask !== null) {
    return true
  }
  return false
}

function unstable_runWithPriority(
  priorityLevel: number,
  eventHandler: Function,
) {
  switch (priorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
    case LowPriority:
    case IdlePriority:
      break
    default:
      priorityLevel = NormalPriority
  }

  const previousPriorityLevel = currentPriorityLevel
  currentPriorityLevel = priorityLevel

  try {
    return eventHandler()
  } finally {
    currentPriorityLevel = previousPriorityLevel
  }
}

function unstable_next(eventHandler: Function) {
  let priorityLevel
  switch (currentPriorityLevel) {
    case ImmediatePriority:
    case UserBlockingPriority:
    case NormalPriority:
      // Shift down to normal priority
      priorityLevel = NormalPriority
      break
    default:
      // Anything lower than normal priority should remain at the current level.
      priorityLevel = currentPriorityLevel
      break
  }

  const previousPriorityLevel = currentPriorityLevel
  currentPriorityLevel = priorityLevel

  try {
    return eventHandler()
  } finally {
    currentPriorityLevel = previousPriorityLevel
  }
}

function unstable_scheduleCallback(priorityLevel: number, callback: Function) {
  const currentTime = getCurrentTime()

  let timeout
  switch (priorityLevel) {
    case ImmediatePriority:
      timeout = IMMEDIATE_PRIORITY_TIMEOUT
      break
    case UserBlockingPriority:
      timeout = USER_BLOCKING_PRIORITY_TIMEOUT
      break
    case IdlePriority:
      timeout = IDLE_PRIORITY_TIMEOUT
      break
    case LowPriority:
      timeout = LOW_PRIORITY_TIMEOUT
      break
    case NormalPriority:
    default:
      timeout = NORMAL_PRIORITY_TIMEOUT
      break
  }

  const expirationTime = currentTime + timeout

  const newTask = {
    id: taskIdCounter++,
    callback,
    priorityLevel,
    expirationTime,
    sortIndex: -1,
    startTime: currentTime,
  }

  newTask.sortIndex = expirationTime
  push(taskQueue, newTask)
  // Schedule a host callback, if needed. If we're already performing work,
  // wait until the next time we yield.
  if (!isHostCallbackScheduled && !isPerformingWork) {
    isHostCallbackScheduled = true
    requestHostCallback(flushWork)
  }

  return newTask
}

function unstable_pauseExecution() {
  isSchedulerPaused = true
}

function unstable_continueExecution() {
  isSchedulerPaused = false
  if (!isHostCallbackScheduled && !isPerformingWork) {
    isHostCallbackScheduled = true
    requestHostCallback(flushWork)
  }
}

function unstable_getFirstCallbackNode() {
  return peek(taskQueue)
}

function unstable_cancelCallback(task: Task) {
  // Null out the callback to indicate the task has been canceled. (Can't
  // remove from the queue because you can't remove arbitrary nodes from an
  // array based heap, only the first one.)
  task.callback = null
}

function unstable_getCurrentPriorityLevel() {
  return currentPriorityLevel
}

let isMessageLoopRunning = false
let scheduledHostCallback: null | typeof flushWork = null
// let taskTimeoutID: NodeJS.Timeout | null = null

// Scheduler periodically yields in case there is other work on the main
// thread, like user events. By default, it yields multiple times per frame.
// It does not attempt to align with frame boundaries, since most tasks don't
// need to be frame aligned; for those that do, use requestAnimationFrame.
const frameInterval = frameYieldMs
let startTime = -1

function shouldYieldToHost() {
  const timeElapsed = getCurrentTime() - startTime
  if (timeElapsed < frameInterval) {
    // The main thread has only been blocked for a really short amount of time;
    // smaller than a single frame. Don't yield yet.
    return false
  }

  // `isInputPending` isn't available. Yield now.
  return true
}

const performWorkUntilDeadline = () => {
  if (scheduledHostCallback !== null) {
    const currentTime = getCurrentTime()
    // Keep track of the start time so we can measure how long the main thread
    // has been blocked.
    startTime = currentTime
    const hasTimeRemaining = true

    // If a scheduler task throws, exit the current browser task so the
    // error can be observed.
    //
    // Intentionally not using a try-catch, since that makes some debugging
    // techniques harder. Instead, if `scheduledHostCallback` errors, then
    // `hasMoreWork` will remain true, and we'll continue the work loop.
    let hasMoreWork = true
    try {
      hasMoreWork = scheduledHostCallback(hasTimeRemaining, currentTime)
    } finally {
      if (hasMoreWork) {
        // If there's more work, schedule the next message event at the end
        // of the preceding one.
        schedulePerformWorkUntilDeadline()
      } else {
        isMessageLoopRunning = false
        scheduledHostCallback = null
      }
    }
  } else {
    isMessageLoopRunning = false
  }
}

let schedulePerformWorkUntilDeadline: () => void
if (typeof setImmediate === "function") {
  // Node.js and old IE.
  // There's a few reasons for why we prefer setImmediate.
  //
  // Unlike MessageChannel, it doesn't prevent a Node.js process from exiting.
  // (Even though this is a DOM fork of the Scheduler, you could get here
  // with a mix of Node.js 15+, which has a MessageChannel, and jsdom.)
  // https://github.com/facebook/react/issues/20756
  //
  // But also, it runs earlier which is the semantic we want.
  // If other browsers ever implement it, it's better to use it.
  // Although both of these would be inferior to native scheduling.
  schedulePerformWorkUntilDeadline = () => {
    setImmediate(performWorkUntilDeadline)
  }
} else if (typeof MessageChannel !== "undefined") {
  // DOM and Worker environments.
  // We prefer MessageChannel because of the 4ms setTimeout clamping.
  const channel = new MessageChannel()
  const port = channel.port2
  channel.port1.onmessage = performWorkUntilDeadline
  schedulePerformWorkUntilDeadline = () => {
    port.postMessage(null)
  }
} else {
  // We should only fallback here in non-browser environments.
  schedulePerformWorkUntilDeadline = () => {
    setTimeout(performWorkUntilDeadline, 0)
  }
}

function requestHostCallback(callback: typeof flushWork) {
  scheduledHostCallback = callback
  if (!isMessageLoopRunning) {
    isMessageLoopRunning = true
    schedulePerformWorkUntilDeadline()
  }
}

export {
  ImmediatePriority as unstable_ImmediatePriority,
  UserBlockingPriority as unstable_UserBlockingPriority,
  NormalPriority as unstable_NormalPriority,
  IdlePriority as unstable_IdlePriority,
  LowPriority as unstable_LowPriority,
  unstable_runWithPriority,
  unstable_next,
  unstable_scheduleCallback,
  unstable_cancelCallback,
  unstable_getCurrentPriorityLevel,
  shouldYieldToHost as unstable_shouldYield,
  unstable_continueExecution,
  unstable_pauseExecution,
  unstable_getFirstCallbackNode,
  getCurrentTime as unstable_now,
}

export type { Task as TaskNode }
