// 该 babel 配置用于 jest

module.exports = {
  presets: [
    ["@babel/preset-env", { targets: { node: "current" } }],

    // Babel对Typescrip的支持是纯编译形式（无类型校验），因此Jest在运行测试时不会对它们进行类型检查。
    // 如果需要类型校验，可以改用ts-jest
    "@babel/preset-typescript",
    ["@babel/preset-react", { runtime: "automatic" }],
  ],
}
