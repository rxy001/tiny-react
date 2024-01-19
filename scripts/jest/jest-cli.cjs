#!/usr/bin/env node

const { spawn } = require("child_process")

const config = "./scripts/jest/jest-config.cjs"
const jest = "./scripts/jest/jest.cjs"

function getCommandArgs() {
  // Add the correct Jest config.
  // jest 路径不能替换成 jest 命令或者 ./bin/jest
  const args = [jest, "--config", config]

  if (process.argv.includes("--debug")) {
    args.unshift("--inspect-brk")
    args.push("--runInBand")
  }

  return args
}

function main() {
  // jest.ts: import "jest-cli/bin/jest"
  // const args = ["./scripts/jest/jest.ts", "--config", config]
  // const jest = spawn("ts-node-esm", args, {
  //   stdio: "inherit",
  //   env: { ...process.env },
  // })
  // 使用 ts-node-esm 会报 module type 错误
  // Error: Must use import to load ES Module: /Users/devin/Desktop/react-x/scripts/jest/jest-config.ts
  // 这是由于 jest 内部使用的是 commonjs 而 ts-node-esm 使用的是 es module
  // jest 内部使用如下代码覆盖其模块类型，但还是报错
  // 解决方法：在根目录 tsconfig.json 手动添加以下配置就行了。不理解？
  // const tsNode = await import('ts-node');
  // return tsNode.register({
  //   compilerOptions: {
  //     module: 'CommonJS'
  //   },
  //   moduleTypes: {
  //     '**': 'cjs'
  //   }
  // });
  // 解决了但发现不仅要写类型而且官方单测还跑不起来，放弃了还是使用 js 吧

  const args = getCommandArgs()

  const command = `${args.join(" ")}`

  console.log("command", `node ${command}`)

  // Run Jest.
  const jest = spawn("node", args, {
    stdio: "inherit",
    env: { ...process.env },
  })

  // Ensure we close our process when we get a failure case.
  jest.on("close", (code) => {
    // Forward the exit code from the Jest process.
    if (code === 1) {
      process.exit(1)
    }
  })
}

main()
