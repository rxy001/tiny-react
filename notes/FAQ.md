### FAQ

1. `FiberRoot` 与 `RootFiber` 区别
   - `FiberRoot` 保存 `React` 运行时依赖的全局状态，与普通的 `Fiber Node` 结构不同。
   - `RootFiber` 与普通的 `Fiber Node` 结构一样，作为初始组件 (`<App />`) 的父组件，`Fiber Tree` 的起点。
   - `FiberRoot.current === RootFiber.stateNode`，因此每次 `render` 时可以轻松获得 `Fiber Tree` 起点，对其进行更新
2. SharedQueue 分为 pending 和 interleaved 两个队列？

   pending 队列为当前更新的 update 集合， interleaved 为下次更新的 update 集合。

   在 render 阶段执行之前，interleaved 队列中的 update 都将转移到 pending 队列中。render 阶段产生的 update ，将添加的 pending 队列中，意味着将在此次 render 阶段更新该 update。

3. MarkUpdateLaneFromFiberToRoot 为什么更新 sourceFiber.alternate 的 lanes 和 childLanes ?

4. Fiber 的 type、elementType 字段的区别？

   ElementType 为 ReactElement.type. 通常情况下 type === elementType. Lazy、Fragment 类型的 fiber，type 为 null

5. FunctionComponent 类型的 Fiber 结构

   memoizedState: 保存了 hooks 链表

   flags: 节点的增删改等操作，还有 PassiveEffect 等 effect side

   updateQueue: effect 链表

6. DOM 节点如何插入到 DOM 树中 ？

   在 reconciler 阶段，如果 fiber 在同一层级发生了移动或者存在 alternate 的父 Fiber (即复用了 current.alternate)的子 Fiber 创建时，都会标记 fiber.flags 为 Placement （暂时称为该 fiber 为 rootFiber）。接下来的 reconciler 过程中 rootFiber 的子代 Fiber 都将是新建的。

   在 completeWork 中，对与 HostComponent、HostText 类型且不存在 stateNode 的 fiber ，会创建 DOM 实例，并且递归添加其子代 DOM 实例。comPleteWork 工作循环实际上也是后序遍历，优先处理子代 fiber。当处理到 rootFiber 时，此时已经形成了一颗小 DOM Tree，只是还未插入到已渲染的 DOM Tree 中。

   在 commit 阶段，会处理存在 Placement Flag 的 rootFiber ，将 rootFiber 最近的子 DOM 实例插入到最近的父 DOM 实例中。

   ```js
   function commitPlacement(finishedWork: Fiber): void {
     // Recursively insert all host nodes into the parent.
     const parentFiber = getHostParentFiber(finishedWork);

     // Note: these two variables *must* always be updated together.
     switch (parentFiber.tag) {
       case HostComponent: {
         const parent: Instance = parentFiber.stateNode;
         const before = getHostSibling(finishedWork);
         // We only have the top Fiber that was inserted but we need to recurse down its
         // children to find all the terminal nodes.
         insertOrAppendPlacementNode(finishedWork, before, parent);
         break;
       }
       case HostRoot: {
         const parent: Container = parentFiber.stateNode.containerInfo;
         const before = getHostSibling(finishedWork);
         insertOrAppendPlacementNodeIntoContainer(finishedWork, before, parent);
         break;
       }
       // eslint-disable-next-line-no-fallthrough
       default:
         throw new Error(
           "Invalid host parent fiber. This error is likely caused by a bug " +
             "in React. Please file an issue."
         );
     }
   }
   ```

   ```jsx
   function App() {
     return <div></div>
   }
   ReactDOM.createRoot(document.getElementById("root")).render(<App />)
   ```

   例如上述 demo ，在初次挂载时，createRoot 已经创建了两个 fiber，fiberRoot 与 rootFiber。调用 render 后，进入 reconciler 阶段，此时会复用 rootFiber，因此 rootFiber.child（App）会被标记 Placement，在 commit 阶段，commitPlacement 将 div 插入到 container 中，渲染到屏幕上。
