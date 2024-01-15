import { jsx as jsxProd } from "./ReactJSXElement"

const jsx = jsxProd
// we may want to special case jsxs internally to take advantage of static children.
// for now we can ship identical prod functions
const jsxs = jsxProd
const jsxDEV = jsxProd

export { jsx, jsxs, jsxDEV }
