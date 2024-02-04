import { useState } from "react"

function App() {
  const [first, setFirst] = useState("")
  const [last, setLast] = useState("")

  console.log("render")

  return (
    <div>
      <button
        onClick={() => {
          Promise.resolve().then(() => {
            setFirst("r")
            setLast("xy")
          })
        }}
      >
        click
      </button>
      <p>
        {first} {last}
      </p>
    </div>
  )
}

export default App
