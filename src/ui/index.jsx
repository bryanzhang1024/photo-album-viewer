import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './design/base.css';

const container = document.getElementById('root');
createRoot(container).render(<App />);
