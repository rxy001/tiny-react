#### `BatchedUpdates`

React 视图的更新，通常是由 `setState` 函数所驱动。如果每次调用 `setState` 都触发完整的渲染流程，那么 JS 引擎可能会长时间霸占渲染进程导致页面无法响应。React 将 `setState` 设计为批量处理 `updates` 来解决该问题。

本文中的 `setState` 的异步实际上指的是批处理更新，同步指的是 `setState` 后直接进行更新。

`setState` 在合成事件处理函数、生命周期函数中调用，这时表现为异步。但是在原生事件处理函数、定时器、`Promise` 中调用 `setState` 将表现为同步（在 React18 中 `concurrent` 模式也为异步）。接下来将从源码分析如何实现 `batchedUpdates` 以及为何会有同步和异步的差异性。

`setState` 实现方式类似于浏览器中的 `EventLoop`。每次调用 `setState`，就将其 `update` 放置到一个队列中，等时机成熟，再把队列中的 `update` 合并生成新的 `state`，最后只对最新的 `state` 进行渲染。

##### Legacy Mode

那么如何去判定这个时机呢？跟 `executionContext` 变量息息相关。_暂时不考虑 `concurrent` 模式。_

每次调用 `setState` 都会进入 `scheduleUpdateOnFiber` 函数，将任务 `performSyncWorkOnRoot` 添加到 `syncQueue` 队列中，然后判断是否执行 `syncQueue` 队列中的任务。执行 `syncQueue` 队列中任务的函数不仅是 `flushSyncCallbacksOnlyInLegacyMode`，还有 `flushSyncCallbacks`，两者执行逻辑基本一致。

```js
function scheduleUpdateOnFiber(root, fiber) {
  ......
  // 注册任务，会忽略掉相同优先级的任务
  ensureRootIsScheduled(root, fiber)

  // legacy mode 的 lane 都为 SyncLane
  // (fiber.mode & ConcurrentMode) === NoMode 表明为 legacy mode。 这里判断 mode 是因为 concurrent mode 也会产生 SyncLane 的任务
  if (
    lane === SyncLane &&
    executionContext === NoContext &&
    (fiber.mode & ConcurrentMode) === NoMode
  ) {
    // 现在清空同步工作，除非我们已经在工作或在批处理中。
    // 我们仅对用户发起的更新执行此操作，以保留旧模式的历史行为。例如在定时器中同步更新的行为
    // 执行任务，进入 reconciler 阶段
    flushSyncCallbacksOnlyInLegacyMode()
  }
}

function flushSyncCallbacks() {
  if (!isFlushingSyncQueue && syncQueue !== null) {
    // Prevent re-entrance.
    isFlushingSyncQueue = true
    let i = 0
    try {
      const isSync = true
      const queue = syncQueue
      for (; i < queue.length; i++) {
        let callback = queue[i]
        do {
          callback = callback(isSync)
        } while (callback !== null)
      }
      syncQueue = null
      includesLegacySyncCallbacks = false
    } catch (error) {
      // If something throws, leave the remaining callbacks on the queue.
      if (syncQueue !== null) {
        syncQueue = syncQueue.slice(i + 1)
      }
      // Resume flushing in the next tick
      scheduleCallback(ImmediatePriority, flushSyncCallbacks)
      throw error
    } finally {
      isFlushingSyncQueue = false
    }
  }
  return null
}

```

如果 `setState` 位于合成事件处理函数中，那也将处于 `batchedUpdates` 上下文里。修改 `executionContext` 变量，再调用 `setState` 进入 `scheduleUpdateOnFiber` 时，`executionContext` 已经不为 `NoContext`，因此不会执行 `syncQueue` 中的任务，直到多个 `setState` 都执行完成后，再回退到 `batchedUpdates`函数中，执行 `flushSyncCallbacksOnlyInLegacyMode`。

```js
function batchedUpdates(fn) {
  const prevExecutionContext = executionContext
  executionContext |= BatchedContext
  try {
    return fn(a)
  } finally {
    executionContext = prevExecutionContext
    // If there were legacy sync updates, flush them at the end of the outer
    // most batchedUpdates-like method.
    if (executionContext === NoContext) {
      flushSyncCallbacksOnlyInLegacyMode()
    }
  }
}
```

```js
const onClick = useCallback(() => {
  setTimeout(() => {
    setCount((p) => p + 1)
    setCount((p) => p + 1)
  }, 0)
}, [])

<div onClick={onClick} />
```

如上述示例，`setCount` 将为同步更新。这是由于在执行 `setCount` 时，此时已经跳出了 `batchedUpdates` 上下文，因此在 `scheduleUpdateOnFiber` 中将会执行 `flushSyncCallbacksOnlyInLegacyMode`。

若在 `useEffect` 中调用 `setState`，那么 `setState` 将处于 `flushPassiveEffectsImpl` 上下文中，`flushPassiveEffectsImpl` 会修改 `executionContext` 为 `CommitContext` ，当 `effect hooks` 执行结束后调用 `flushSyncCallbacks` 执行全部的 `update` , 因此可异步。

```js
function flushPassiveEffectsImpl() {
  const root = rootWithPendingPassiveEffects
  rootWithPendingPassiveEffects = null

  if ((executionContext & (RenderContext | CommitContext)) !== NoContext) {
    throw new Error("Cannot flush passive effects while already rendering.")
  }

  const prevExecutionContext = executionContext
  executionContext |= CommitContext

  commitPassiveUnmountEffects(root.current)
  commitPassiveMountEffects(root, root.current)

  executionContext = prevExecutionContext

  // effects 可能会产生新的 update, 将 performSyncWorkOnRoot 推进同步任务队列中。
  flushSyncCallbacks()

  return true
}
```

若在 `useLayoutEffect` 中调用 `setState`，因为 `layoutEffects` 是在 `commit` 阶段同步执行的，此时`executionContext |= CommitContext`，因此也可以批量更新。如果是同步渲染（legacy mode 都为同步任务）这里实际上不需要额外的调用 `flushSyncCallbacks`，因为此时 `syncQueue` 队列中已经包含了新 `performSyncWorkOnRoot` 任务，旧 `performSyncWorkOnRoot` 函数还未执行结束，当其执行结束后，`flushSyncCallbacks` 将循环至新的 `performSyncWorkOnRoot` 任务继续执行。而 `concurrent mode`可能为异步更新，并非通过调用 `flushSyncCallbacks` 或者 `flushSyncCallbacksOnlyInLegacyMode` 进行更新，因此需要调用 `flushSyncCallbacks`同步更新。

```js
function commitRootImpl(root, renderPriorityLevel) {
  //... 略过部分代码
  if (subtreeHasEffects || rootHasEffect) {
    const prevExecutionContext = executionContext
    executionContext |= CommitContext
    //... 略过部分代码
    commitLayoutEffects(finishedWork, root, lanes)
  }
  //... 略过部分代码
  // If layout work was scheduled, flush it now.
  // 如果是 concurrent mode 异步任务产生的同步更新，在这里尽早的执行。
  // 如果是 legacy mode，基本没用
  flushSyncCallbacks()
}
```

由此可见，从代码逻辑上来看，每次 `setState` 后都应为同步更新，但 React 为了优化性能实现批量更新。在合成事件、`useEffect`、 `useLayoutEffect` 中修改 `executionContext` 阻止了同步更新，并最后分别调用 `flushSyncCallbacks` 再进行更新。

若想批量更新，可使用 `flushSync` 或者 `unstable_batchedUpdates`，区别在于：

1. `flushSync` 在 `legacy mode` 模式会调用 `flushPassiveEffects`。(In legacy mode, we flush pending passive effects at the beginning of the next event, not at the end of the previous one.)

2. 为 `update` 分配的 `lane` 不同, `flushSync` 中的 `update` 都将是 `SyncLane`。 `unstable_batchedUpdates` 中 `concurrent mode` 下 `update` 为 `DefaultLane` ，`legacy mode` 下 `update` 为 `SyncLane`。

##### Concurrent Mode

React 18 中新增的自动批处理(automatic batching)。即在定时器、Promise、原生事件中 `setState` 也能批量处理。

当在 `concurrent mode` 中，`update` 的 `lane` 跟 `setState` 所处的上下文有关 (源码中以 `window.event` 判断所处上下文)。例如原生事件中，`click、input、focus`都为 `SyncLane`， `mousemove 、scroll` 为 `InputContinuousLane`，而定时器基本都为 `DefaultLane`.

如果 `lane` 为 `syncLane` 那么会通过 `scheduleSyncCallback` 调度一个同步更新任务（`performSyncWorkOnRoot`）。当在同一上下文中多次调用 `setState`, 不会像 `legacy mode` 那样在`scheduleUpdateOnFiber` 判断所处的执行上下文（ `executionContext` ）来确定是否执行同步更新，而是通过 `scheduleMicrotask` 注册的微任务异步去执行同步更新，以支持批量更新。

```js
function ensureRootIsScheduled(root, currentTime) {
  //...省略代码
  if (newCallbackPriority === SyncLane) {
    if (root.tag === LegacyRoot) {
      scheduleLegacySyncCallback(performSyncWorkOnRoot.bind(null, root))
    } else {
      scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root))
    }

    // concurrent mode ，update 存在 sync，通过注册微任务执行同步任务。
    // 这里注册微任务带来好处是 concurrent mode 中产生的同步更新自动批处理
    // 例如 合成点击事件中 promise.then 多次 setState , 原生点击事件中多次的 setState
    scheduleMicrotask(() => {
      if ((executionContext & (RenderContext | CommitContext)) === NoContext) {
        // Note that this would still prematurely flush the callbacks
        // if this happens outside render or commit phase (e.g. in an event).
        flushSyncCallbacks()
      }
    })
    newCallbackNode = null
  }
}
```

如果 `lane` 非 `SyncLane`，那就更简单了。通过 `scheduleCallback` 去异步执行 `performConcurrentWorkOnRoot` ，那么在同一上下文的 `setState` 还能不批量更新吗？

```js
function ensureRootIsScheduled(root, currentTime)() {
   // ...省略代码
    let schedulerPriorityLevel
    switch (lanesToEventPriority(nextLanes)) {
      case DiscreteEventPriority:
        schedulerPriorityLevel = ImmediateSchedulerPriority
        break
      case ContinuousEventPriority:
        schedulerPriorityLevel = UserBlockingSchedulerPriority
        break
      // ...省略代码
    }
    // scheduleCallback 实际为 Scheduler 包中的 unstable_scheduleCallback
    newCallbackNode = scheduleCallback(
      schedulerPriorityLevel,
      performConcurrentWorkOnRoot.bind(null, root)
    )
}
```
