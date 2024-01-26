import { useState, useEffect, useLayoutEffect } from "react"

function App() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    console.log("useEffect app")

    return () => {
      console.log("useEffect destroy app")
    }
  })

  useLayoutEffect(() => {
    console.log("useLayoutEffect app")

    return () => {
      console.log("useLayoutEffect destroy app")
    }
  })

  return <div>App</div>
}

function Child() {
  console.log("render child")

  useEffect(() => {
    console.log("useEffect Child")

    return () => {
      console.log("useEffect destroy Child")
    }
  })

  useLayoutEffect(() => {
    console.log("useLayoutEffect Child")

    return () => {
      console.log("useLayoutEffect destroy Child")
    }
  })

  return <Children />
}
function Children() {
  console.log("render Children")

  useEffect(() => {
    console.log("useEffect Children")

    return () => {
      console.log(" useEffect destroy Children")
    }
  })

  useLayoutEffect(() => {
    console.log("useLayoutEffect Children")

    return () => {
      console.log("useLayoutEffect destroy Children")
    }
  })

  return <div>Children</div>
}

function Parent() {
  console.log("render parent")

  useLayoutEffect(() => {
    console.log("useLayoutEffect Parent")

    return () => {
      console.log("destroy Parent")
    }
  })
  return (
    <div>
      <App />
      <Child />
    </div>
  )
}

export default Parent
