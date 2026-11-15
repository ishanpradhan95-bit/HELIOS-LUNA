import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './store/useStore';
import './styles.css';
if (import.meta.env.DEV) (window as unknown as { helios: typeof useStore }).helios = useStore; // dev-only debugging handle
createRoot(document.getElementById('root')!).render(<App />);
