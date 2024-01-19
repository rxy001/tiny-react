module.exports = {
  rootDir: process.cwd(),
  roots: ["<rootDir>/packages"],
  verbose: true,
  testMatch: ["<rootDir>/packages/**/__tests__/**/*.{spec,test}.{js,jsx}"],
  testEnvironment: "jsdom",
  watchman: true,

  // 必须加上 "ts", "tsx" ，否则 jest 无法加载此类型文件
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
}
