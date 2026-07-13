import { useEffect } from 'react';
import { useStore } from './store';
import { useSSE } from './hooks/useSSE';
import { requestNotificationPermission } from './hooks/useNotifications';
import { DidSwitcher } from './components/DidSwitcher';
import { ContactList } from './components/ContactList';
import { Thread } from './components/Thread';
import { Composer } from './components/Composer';

export function App() {
  useSSE();
  const init = useStore((s) => s.init);
  const status = useStore((s) => s.status);
  const sseStatus = useStore((s) => s.sseStatus);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="app" onClick={() => requestNotificationPermission()}>
      <aside className="sidebar">
        <header className="sidebar-header">
          <DidSwitcher />
        </header>
        <ContactList />
        <StatusBar status={status} sseStatus={sseStatus} />
      </aside>

      <main className="main">
        {loading && <div className="loading-bar">Connecting…</div>}
        {error && <div className="error-bar">{error}</div>}
        <Thread />
        <Composer />
      </main>
    </div>
  );
}

function StatusBar({
  status,
  sseStatus,
}: {
  status: ReturnType<typeof useStore.getState>['status'];
  sseStatus: 'connecting' | 'connected';
}) {
  if (!status) return null;
  return (
    <footer className="status-bar">
      <span>
        <span className={`sse-dot ${sseStatus}`} />
        {sseStatus === 'connected' ? 'Live' : 'Reconnecting'}
      </span>
      <span title={`Poller: ${status.poller}`}>📡</span>
      <span title={`Contacts: ${status.carddav}`}>👤</span>
    </footer>
  );
}
