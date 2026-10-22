import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import RecordingOverlay from './components/RecordingOverlay';
import OverlayInteraction from './components/OverlayInteraction';
import HistoryPage from './pages/HistoryPage';
import GardenPage from './pages/GardenPage';
import DebugPage from './pages/DebugPage';
import { installDebugLogger } from './components/DebugLogger';
import '@fontsource-variable/inter';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,        // 5 minutes - data stays fresh
      gcTime: 10 * 60 * 1000,          // 10 minutes - cache retention
      retry: 1,                         // Only retry once for transient errors
      refetchOnWindowFocus: false,      // Disable for desktop app
    },
  },
});

// Check which window this is based on hash
const hash = window.location.hash;
const isOverlay = hash === '#/overlay';
const isOverlayInteraction = hash === '#/overlay-interaction';
const isHistory = hash === '#/history';
const isGarden = hash === '#/garden';
const isDebug = hash === '#/debug';

// Dev builds capture the main window's logs for the debug console from the start
if (import.meta.env.DEV && !hash) installDebugLogger();

// Render appropriate component based on window
function RootComponent() {
  if (isOverlay) return <RecordingOverlay />;
  if (isOverlayInteraction) return <OverlayInteraction />;
  if (isHistory) return <HistoryPage />;
  if (isGarden) return <GardenPage />;
  if (isDebug) return <DebugPage />;
  return (
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootComponent />
  </React.StrictMode>,
);
