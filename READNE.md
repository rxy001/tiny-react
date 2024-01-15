### tiny-react

#### feature

1.  基于 Fiber 架构实现 React 组件同步更新与挂载.

- Scheduler 实现
- React 运行时准备阶段
- 同步模式下 Render 阶段的实现，包括 beginWork、completeWork
- 支持单节点和多节点协调
- Commit 阶段，根据 ReactDOM 包中 API 挂载与更新 DOM 节点
- 支持函数式组件、原生组件、文本组件
