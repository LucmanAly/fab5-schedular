import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import PublicScheduleView from './PublicScheduleView';
import './styles.css';

// A worker's permanent link (?view=TOKEN) never mounts the authenticated app
// shell at all — no login gate, no wizard-boot effects, just a minimal
// read-only fetch of that one worker's current schedule.
const viewToken = new URLSearchParams(window.location.search).get('view');

createRoot(document.getElementById('root')).render(
  <React.StrictMode>{viewToken ? <PublicScheduleView token={viewToken} /> : <App />}</React.StrictMode>
);
