import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

if (!import.meta.env.DEV) {
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.debug = noop;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
