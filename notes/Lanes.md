### Lanes

`Lane`（赛道）一个启用 1 个 bit 的 bitmask，有 31 个优先级粒度，31 是 bitmask 可以容纳的数量，当 bit 越靠右则优先级越高。`Lane` 表示单个任务，`Lanes` 可表示多个任务。在 React 中由 `setState` 调度的 `update` 都将只分配一个 `lane` 。`Lane` 不仅用于标记 `update` 的优先级，也可用于表示更新任务的优先级。

对每个优先级只使用一个 `Lane`。例如，所有同步 `update` 都分配 `SyncLane`。如果有多个待处理的同步 `update`，它们总是会在同一批次中处理。这几乎总是更好的性能，因为它减少了多次布局传递、多次样式重新计算、多次绘制等的开销。

```js
export const TotalLanes = 31
export const NoLanes = /*                         */ 0b0000000000000000000000000000000
export const NoLane = /*                          */ 0b0000000000000000000000000000000
export const SyncLane = /*                        */ 0b0000000000000000000000000000001
export const DefaultLane = /*                     */ 0b0000000000000000000000000010000
```

一个 `fiber` 可能关联一个或多个 `update` ，因此其通过 `lanes` 字段记录所有的 `update.lane`。 React 每次更新都与一个或多个 `lane` 相关联（`RenderLanes`），在处理 `updateQueue` 时只有跟 `RenderLanes` 相同的或其子集 ( `renderLanes & lane === lane` ) 的 `update` 才会处理。

`transition` 具备多个 `lane` ，为 `update` 分配 `lane` 的算法是对单个事件中的所有 `transition` 分配相同的 `lane` 。

```js
startTransition(() => {
  setState1() // update.lane 64
  setState2() // update.lane 64
})
```

该算法是启发式的，在事件中缓存每个输入的第一个，然后确定时间结束时（ `performConcurrentWorkOnRoot` 执行开始）重置缓存的值（具体可看下方 `requestUpdateLane`）。意味在两次 `performConcurrentWorkOnRoot` 执行之间所产生的 `transition` 的 `update.lane` 是相同的。

> 为什么要为 `transition` 分配多个 `lane`
>
> 提示： IO 可理解为 数据的请求
>
> For priorities that are assumed to be CPU-bound — meaning if something suspends we will immediately show a fallback instead of waiting for promises to resolve — we use only a single lane per priority. For example, all synchronous updates are assigned the SyncLane. If there are multiple pending sync updates, they will always render in a single batch. This is almost always better for performance because it reduces overhead of multiple layout passes, multiple style recalculations, multiple paints, and so on.
>
> But the benefits of batching don't hold if the updates aren't CPU-bound. We have a several priorities like this; the main kind are called _transitions_. These are updates that are wrapped in a startTransition call. When a transition suspends, sometimes we choose not to show a fallback immediately (exactly why and how we decide to do this is a subject for another thread) and instead wait for the promises to resolve. This means that these updates can sometimes be _IO-bound_ instead of CPU-bound. If we were to assign the same lane to all transitions, then one transition could effectively block all other transitions, even ones that are unrelated. In this way, batching can actually hurt perceived performance instead of helping.
>
> So transitions don't all receive the same lane. We assign different lanes to successive transitions. Sometimes two unrelated transitions may happen to be assigned the same lane, because we only have a finite number. But usually in practice they'll have different lanes, and therefore can be finished independently.
>
> 更多信息可看：https://github.com/reactwg/react-18/discussions/27

目前虽然是为 `transition` 分配了多个 `lane` ，但所有的 `transition` 是批量处理的，甚至跨越多个交互。如果存在某个 `transition` 挂起，依然会阻塞所有的 `transition` 。并没如 @acdlite 所言，不相关的 `transition` 可以正常更新。

当对一个 `state` 使用了多个 `startTransition` 时，跳过显示中间状态，只渲染最新的更新。例如非常快速地在选项卡之间切换，只显示单击的最后一个选项卡。通过将所有选项卡导航合并到一个批处理中来实现这一点。@acdlite 又提出了一个新的概念 "Entanglement"，强制一条 `lane` 依赖于另一条未完成的 `lane` 在同一批次中完成，以此来跳过中间 `transition` 状态。在一系列相关 `transition` 中，只有最近的 `transition` 才能被允许完成。通常，检测到多个更新来自同一个源时，才会去 entangle updates。通过它们（`startTransition`）是否更新一个或多个相同的状态队列 (`useState, useReducer`) 来确定。
