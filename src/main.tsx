import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { initCloud } from './lib/cloud';
import { connectKeyFromHash } from './lib/market';
import './styles.css';

initCloud();
// take a ?fmpkey= deep link BEFORE the first render, so every screen mounts
// with the key already available rather than reading an empty one
connectKeyFromHash();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
