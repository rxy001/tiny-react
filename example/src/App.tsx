import { useState, memo } from "react"

function Child() {
  return <div>child</div>
}

const M = memo(Child)

function App() {
  const [count, setCount] = useState(1)

  return (
    <div>
      <button
        onClick={() => {
          setCount((c) => c + 1)
        }}
      >
        click
      </button>
      {count}
      <M />
    </div>
  )
}

export default App
