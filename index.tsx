
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Registrar Service Worker via VitePWA
// O plugin gera o SW automaticamente e o registerSW cuida da atualização
import { registerSW } from 'virtual:pwa-register';

const updateSW = registerSW({
  onNeedRefresh() {
    console.log('🔄 Nova versão disponível. Recarregue para atualizar.');
  },
  onOfflineReady() {
    console.log('✅ App pronto para funcionar offline!');
  },
  onRegistered(registration) {
    console.log('✅ Service Worker registrado:', registration);
  },
  onRegisterError(error) {
    console.error('❌ Erro ao registrar Service Worker:', error);
  }
});

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
