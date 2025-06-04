#### Automatic Batching

在定时器、Promise、原生事件中调用 `setState` 也能批量处理，其实现依赖于微任务和宏任务(可看 BatchedUpdates.md)。

官方介绍 https://github.com/reactwg/react-18/discussions/21

#### Transitions

`transition` 功能依赖与 React 新的渲染机制—并发渲染，它是一个新的底层机制。在并发渲染中，可能开始渲染一个更新，然后中途挂起，稍后又继续。它甚至可能完全放弃一个正在进行的渲染。React 保证即使渲染被中断，UI 也会保持一致。为了实现这一点，它会在整个 DOM 树被计算完毕前一直等待，完毕后再执行 DOM 变更。这样做，React 就可以在后台提前准备新的屏幕内容，而不阻塞主线程。这意味着用户输入可以被立即响应，即使存在大量渲染任务，也能有流畅的用户体验（并发渲染是主动让权给 UI 线程）。

关于并发渲染模型与工作机制 <https://github.com/reactwg/react-18/discussions/27>

并发渲染在客户端只能通过具有 `transition` 特性的 hooks `useTransition、useDeferredValue` 开启，两个 API 其本质是相同的，降低 `state` 更新优先级，只是使用场景不同：

1. `useTransition` 拥有 state 控制权的地方使用;
2. `useDeferredValue` 不具有 state 的控制权，例如上层组件所传递的 `props`;

`transition` 可以让在视觉发生显著变化期间保持 UI 的响应性。这很难用现有的策略进行优化。即使没有不必要的重新渲染，与将每次更新都视为紧急更新相比，`transition` 提供了更好的用户体验。避免不必要的重新渲染仍然是优化性能的好方法，`transition` 与之互补。

#### Suspense Features
