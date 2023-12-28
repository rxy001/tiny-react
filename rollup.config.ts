import path from "node:path"
import typescript from "@rollup/plugin-typescript"
import { fileURLToPath } from "node:url"
import { defineConfig } from "rollup"
import { nodeResolve } from "@rollup/plugin-node-resolve"
import commonjs from "@rollup/plugin-commonjs"
import terser from "@rollup/plugin-terser"
import alias from "@rollup/plugin-alias"

const __dirname = fileURLToPath(new URL(".", import.meta.url))

const projectRootDir = path.resolve(__dirname)

function resolvePath(...paths: string[]) {
  return path.resolve(projectRootDir, ...paths)
}

export default () =>
  defineConfig({
    input: "src",
    output: {
      dir: "build",
      format: "es",
    },
    plugins: [
      typescript({
        tsconfig: path.resolve(__dirname, "tsconfig.json"),
      }),
      nodeResolve(),
      commonjs(),
      terser(),
      alias({
        entries: {
          shared: resolvePath("./src/shared"),
          scheduler: resolvePath("./src/scheduler"),
          "react-reconciler": resolvePath("./src/react-reconciler"),
          "react-dom": resolvePath("./src/react-dom"),
        },
      }),
    ],
  })
