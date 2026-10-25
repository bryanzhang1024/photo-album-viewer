import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import SettingsPage from './features/settings/SettingsPage';
import './design/base.css';

const container = document.getElementById('root');
const isSettingsWindow = window.location.hash.startsWith('#/settings');
createRoot(container).render(isSettingsWindow ? <SettingsPage /> : <App />);
