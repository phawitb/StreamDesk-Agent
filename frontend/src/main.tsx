import { StrictMode, Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) { return { error: `${e.message}\n${e.stack}` }; }
  render() {
    if (this.state.error) return <pre style={{ color: '#f00', padding: 20, whiteSpace: 'pre-wrap', fontSize: 12 }}>{this.state.error}</pre>;
    return this.props.children;
  }
}

// Catch unhandled errors
window.onerror = (msg, src, line) => {
  document.body.innerHTML = `<pre style="color:red;padding:20px;font-size:12px">Error: ${msg}\n${src}:${line}</pre>`;
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
