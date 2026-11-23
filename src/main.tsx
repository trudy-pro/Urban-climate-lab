import { Component, lazy, Suspense, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

const App = lazy(() => import('./App'));

class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <main className="map-loading" role="alert">
          <p>The interactive map could not start.</p>
          <a href={location.href}>Reload map</a>
        </main>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <MapBoundary>
    <Suspense fallback={<main className="map-loading" role="status">Loading the map…</main>}>
      <App startFreely={new URLSearchParams(location.search).get('view') === 'free'} />
    </Suspense>
  </MapBoundary>,
);
