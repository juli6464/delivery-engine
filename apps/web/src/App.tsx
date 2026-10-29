import { BillingSummary } from './components/BillingSummary';
import { ChatPanel } from './components/ChatPanel';

export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>Delivery Engine</h1>
        <span className="muted">Operaciones</span>
      </header>
      <main className="layout">
        <ChatPanel />
        <BillingSummary />
      </main>
    </div>
  );
}
