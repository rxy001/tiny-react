### Scheduler

Scheduler 是一个任务调度器，它会根据任务的优先级对任务进行调用执行。在有多个任务的情况下，它会先执行优先级高的任务。如果一个任务执行的时间过长，Scheduler 会中断当前任务，让出主线程，避免造成用户操作时界面的卡顿。在下一帧恢复执行未完成的任务。

Scheduler 实现涉及到 MessageChannel 和 EventLoop。这里就不多介绍了，Google。

> **为什么不使用 setTimeout ?**
>
> 官方解释：We prefer MessageChannel because of the 4ms setTimeout clamping.
>
> 我自己尝试了下在嵌套调用下稳定大于 4ms
>
> **为什么不使用 microTask ?**
>
> 微任务将在页面渲染前全部执行完，达不到中断任务后「将主线程还给浏览器」的目的。
>
> **为什么不使用 rAF ？**
>
> 1. rAF 执行时机是在每次 EventLoop 中页面渲染之前执行。通常情况下浏览器每秒渲染 60 次即 16.7ms 一次，那么 rAF 就是 16.7ms 执行一次。Scheduler 规定 JS 执行时间为 5ms， 除去浏览器渲染的时间，那么每一帧中将有段时间是闲置的。
> 2. rAF 也不一定 16.7ms 执行一次，但 rAF 执行次数通常与浏览器屏幕刷新次数相匹配。React 的更新是一项紧急任务，更新任务间隔时间过长影响 React 性能。（浏览器会尽可能的保持帧率稳定。如果浏览器试图达到 60Hz 刷新率，那么每秒最多 60 次渲染机会（大约 16.6ms），当浏览器发现维持不了此速率，那么可能会下降到更可持续的每秒 30 次渲染机会，而不是偶尔丢帧。如果浏览器上下文不可见，那么页面会降低到每秒 4 次甚至更少的渲染机会。）
>
> **为什么不使用 rIC ?**
>
> 1. requestIdleCallback 是在浏览器渲染结束后，两帧之间空闲时间来执行JS。触发时机太晚了。
>
> **为什么使用 MessageChannel ？**
>
> Scheduler 会中断长时间任务，通过 MessageChannel 注册一个宏任务恢复执行该任务，而从达到让步给浏览器。在单帧内尽可能多的去执行任务。

首先介绍下 Scheduler 大概的实现逻辑：

1. `taskQueue` 是一个根据任务过期时间排序的最小堆，待处理任务的队列。
2. 调用 `unstable_scheduleCallback(priorityLevel, callback)` ， 通过 `priorityLevel` 计算任务的过期时间，然后将该任务添加到 `taskQueue`。
3. `port.postMessage(null)` 发出消息通知执行 `performWorkUntilDeadline`
4. `performWorkUntilDeadline` 在规定的时间（5ms）内循环执行 `taskQueue` 中的任务。
   1. 取出优先级最高的任务。
   2. 当达到 5ms 的阈值，结束该任务的执行，让步给浏览器，重复步骤 3。
   3. 当某个任务的执行时超过了其过期时间，则一直执行该任务，不会让步给浏览器。
   4. 当一个任务执行结束后，只要在规定的阈值内继续执行下一个任务。

要想通过 Scheduler 实现时间切片功能，必须搭配可中断、恢复的数据结构以及为 Scheduler 提供可中断、恢复的任务，例如

```js
let i = 0
let num = 10000

unstable_scheduleCallback(4, calculate)

function calculate() {
  // shouldYield 如果任务没有结束，并且 Scheduler 分配的时间段(5ms)已经到期了，放弃执行本任务，把主线程交还给浏览器
  for (; i < num && !shouldYieldToHost(); i++) {
    document.write(i + "\n")
  }
  // 当退出本任务的时候，如果任务没有完成，返回任务函数本身，如果任务完成了就返回 null
  if (i < num) {
    return calculate
  } else {
    return null
  }
}
```

<img src="https://p.ipic.vip/meucao.png" style="zoom: 67%;" />

以下是 React 实现时间切片的原理，与上述代码相似。

```js
function ensureRootIsScheduled(root, currentTime) {
  // ... 省略
  let schedulerPriorityLevel
  switch (lanesToEventPriority(nextLanes)) {
    case DiscreteEventPriority:
      schedulerPriorityLevel = ImmediateSchedulerPriority
      break
    case ContinuousEventPriority:
      schedulerPriorityLevel = UserBlockingSchedulerPriority
      break
    // ... 省略
  }
  // 在这通过 Scheduler 调度更新任务
  newCallbackNode = scheduleCallback(
    schedulerPriorityLevel,
    performConcurrentWorkOnRoot.bind(null, root),
  )
  root.callbackPriority = newCallbackPriority
  root.callbackNode = newCallbackNode
}

// didTimeout 是 Scheduler 传入的参数， Scheduler 在执行任务时会检测任务执行时机是否超时
function performConcurrentWorkOnRoot(root, didTimeout) {
  // ...省略
  const originalCallbackNode = root.callbackNode
  // 在 reconciliation 过程中，concurrent 也可能由于超过了预期时间回退到 sync
  // 因此，即使高优先级任务到来，也无法打断任务的执行了，避免饥饿现象
  const shouldTimeSlice =
    !includesBlockingLane(root, lanes) &&
    !includesExpiredLane(root, lanes) &&
    !didTimeout
  shouldTimeSlice
    ? renderRootConcurrent(root, lanes)
    : renderRootSync(root, lanes)
  // ...省略
  // 当 performConcurrentWorkOnRoot 执行结束后或者任务被打断， root.callbackNode 会发生变化
  if (root.callbackNode === originalCallbackNode) {
    // The task node scheduled for this root is the same one that's
    // currently executed. Need to return a continuation.
    return performConcurrentWorkOnRoot.bind(null, root)
  }
  return null
}

function workLoopConcurrent() {
  while (workInProgress !== null && !shouldYield()) {
    performUnitOfWork(workInProgress)
  }
}
```

接下来直接看源码。Scheduler 是一个通用的包，源码中有 React 暂时没有用到的功能，因此会忽略掉。

```js
// 根据不同优先级，计算出 callback 的过期时间，然后添加到 taskQueue
function unstable_scheduleCallback(priorityLevel, callback) {
  let currentTime = getCurrentTime()

  const startTime = currentTime

  let timeout
  switch (priorityLevel) {
    case ImmediatePriority:
      // -1
      timeout = IMMEDIATE_PRIORITY_TIMEOUT
      break
    // 250
    case UserBlockingPriority:
      timeout = USER_BLOCKING_PRIORITY_TIMEOUT
      break
    // 1073741823
    case IdlePriority:
      timeout = IDLE_PRIORITY_TIMEOUT
      break
    // 10000
    case LowPriority:
      timeout = LOW_PRIORITY_TIMEOUT
      break
    // 5000
    case NormalPriority:
    default:
      timeout = NORMAL_PRIORITY_TIMEOUT
      break
  }

  const expirationTime = startTime + timeout

  const newTask = {
    id: taskIdCounter++,
    callback,
    priorityLevel,
    startTime,
    expirationTime,
    sortIndex: -1,
  }

  newTask.sortIndex = expirationTime
  // 添加到最小堆中，根据 sortIndex 排序
  push(taskQueue, newTask)

  // isHostCallbackScheduled：boolean 类型，flushWork 为异步函数，避免其重复调用
  // isPerformingWork： boolean 类型，是否在 5ms 的工作循环内。
  if (!isHostCallbackScheduled && !isPerformingWork) {
    isHostCallbackScheduled = true
    requestHostCallback(flushWork)
  }

  return newTask
}
```

```js
function requestHostCallback(callback) {
  scheduledHostCallback = callback
  // isMessageLoopRunning： 消息循环是否还在运行，为 true 表明 taskQueue 还有任务未执行
  if (!isMessageLoopRunning) {
    isMessageLoopRunning = true
    schedulePerformWorkUntilDeadline()
  }
}

// 当不支持 MessageChannel 时，会使用 setTimeout 代替
const channel = new MessageChannel()
const port = channel.port2
channel.port1.onmessage = performWorkUntilDeadline
const schedulePerformWorkUntilDeadline = () => {
  // 要想测试 rAF 和 rIC 性能，修改 port.postMessage 为 rAF 或 rIC
  port.postMessage(null)
}
```

```js
let startTime = -1
const performWorkUntilDeadline = () => {
  if (scheduledHostCallback !== null) {
    const currentTime = getCurrentTime()

    // 跟踪启动时间，这样我们就可以测量主线程被阻塞了多长时间，即 task 执行的时长。
    startTime = currentTime
    const hasTimeRemaining = true

    // 如果是调度任务报错，退出当前浏览器任务，以便观察错误。
    // 故意不使用try-catch，因为这会增加调试的难度。
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
```

```js
function flushWork(hasTimeRemaining, initialTime) {
  // 下次安排工作时，我们需要一个主回调函数。
  isHostCallbackScheduled = false
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

// hasTimeRemaining 永远为 true ,实际没用
function workLoop(hasTimeRemaining, initialTime) {
  let currentTime = initialTime

  // 获取优先级最高的任务
  currentTask = peek(taskQueue)
  while (currentTask !== null) {
    // 超过预期时间，直接执行该任务。否则检查本次任务循环是否超过阈值
    if (currentTask.expirationTime > currentTime && shouldYieldToHost()) {
      // This currentTask hasn't expired, and we've reached the deadline.
      break
    }
    const callback = currentTask.callback
    if (typeof callback === "function") {
      currentTask.callback = null
      currentPriorityLevel = currentTask.priorityLevel
      // 该任务是否超过了预期时间
      const didUserCallbackTimeout = currentTask.expirationTime <= currentTime
      // 当 callback 被打断时，需要将 callback 函数本身返回，以继续执行。
      // 若 callback 彻底执行结束，返回 null
      const continuationCallback = callback(didUserCallbackTimeout)
      currentTime = getCurrentTime()
      if (typeof continuationCallback === "function") {
        currentTask.callback = continuationCallback
      } else {
        // 表明 currentTask 执行完了，从队列中删除
        if (currentTask === peek(taskQueue)) {
          pop(taskQueue)
        }
      }
    } else {
      // callback 被取消了，删了
      pop(taskQueue)
    }
    currentTask = peek(taskQueue)
  }
  // Return whether there's additional work
  if (currentTask !== null) {
    return true
  } else {
    return false
  }
}
```

```js
function shouldYieldToHost() {
  // startTime 是在 performWorkUntilDeadline 设定的。即本次宏任务刚开始时
  const timeElapsed = getCurrentTime() - startTime
  // frameInterval 为 5ms
  if (timeElapsed < frameInterval) {
    // The main thread has only been blocked for a really short amount of time;
    // smaller than a single frame. Don't yield yet.
    return false
  }

  return true
}
```

```js
function unstable_cancelCallback(task) {
  // Null out the callback to indicate the task has been canceled. (Can't
  // remove from the queue because you can't remove arbitrary nodes from an
  // array based heap, only the first one.)

  // unstable_cancelCallback 在 callback 内执行是没有用的。并且在执行 callback() 时已经设置了 task.callback = null
  // 在外面调用时，当能够执行 unstable_cancelCallback 时，实际上已经让步给浏览器了，所以一定能够取消该任务。
  // 设置为 null 不影响 workLoop 的执行
  // workLoop 规定的是 5ms 内尽可能多的执行任务，因此即使取消调某个任务，不影响后续任务依然在本次 workLoop 内的执行。
  task.callback = null
}
```
