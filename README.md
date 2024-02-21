### tiny-react

#### ChangeLog

1. 基于 Fiber 架构实现 React 组件同步更新与挂载.

   - Scheduler 实现
   - React 运行时准备阶段
   - 同步模式下 Render 阶段的实现，包括 beginWork、completeWork
   - Reconciler 支持单节点和多节点
   - Commit 阶段，根据 ReactDOM 包中 API 挂载与更新 DOM 节点
   - 支持函数式组件、原生组件、文本组件

2. concurrentRendering 和 hooks

   - 实现 Lanes 优先级机制，用于决定渲染任务的优先级，以支持 concurrentRendering
   - 实现函数式组件 Hooks，包括 useState、useRef(暂时无法用于函数式组件)、useMemo、useCallback、useReducer
   - 目前 Render 阶段尚未实现性能优化，useMemo、useCallback 只能缓存，无法避免组件重复渲染
   - Automatic Batching

3. 根据 Lanes 优化组件重复渲染，实现 useEffect、useLayoutEffect

4. 实现 React.memo
