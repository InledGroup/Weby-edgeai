// sidepanel.js - Bootstrap for the Sidebar AI Chatbot
import { h, render } from 'https://esm.sh/preact';
import { useState, useEffect, useRef } from 'https://esm.sh/preact/hooks';

// We'll try to import our libraries. 
// Note: In a real world scenario, these would be bundled. 
// For this implementation, we assume the environment can resolve these or we provide them.

// Mocking some parts for the demo/implementation if needed, 
// but the goal is to use the real RAG pipeline.

function SidebarApp() {
  const [currentPage, setCurrentPage] = useState(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [status, setStatus] = useState('Esperando contenido de la página...');

  useEffect(() => {
    // Listen for content from the content script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'PAGE_CONTENT_EXTRACTED') {
        handleNewContent(message.data);
      }
    });

    // Request content immediately if sidepanel just opened
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'REQUEST_PAGE_CONTENT' }, (response) => {
          if (chrome.runtime.lastError) {
            console.log('Content script not ready yet');
          }
        });
      }
    });
  }, []);

  async function handleNewContent(data) {
    if (currentPage?.url === data.url && currentPage?.timestamp > data.timestamp - 5000) {
      return; // Skip if same content recently
    }

    setCurrentPage(data);
    setIsIndexing(true);
    setStatus('Indexando contenido de la página...');

    try {
      // Here we use the RAG pipeline to index the content
      // We'll need to import these dynamically or assume they are available
      const { processDocument } = await import('../src/lib/rag/rag-pipeline.js');
      const { EngineManager } = await import('../src/ai/engine-manager.js');
      const { generateUUID } = await import('../src/lib/utils.js');
      
      const documentId = `webpage_${generateUUID()}`;
      const embeddingEngine = await EngineManager.getEmbeddingEngine();
      
      await processDocument(documentId, data.markdown, embeddingEngine, 512, (progress) => {
        setStatus(`Indexando: ${Math.round(progress.progress)}%`);
      });

      setStatus('Página indexada y lista para chatear');
      setIsIndexing(false);
    } catch (error) {
      console.error('Error indexing content:', error);
      setStatus('Error al indexar la página');
      setIsIndexing(false);
    }
  }

  return h('div', { className: 'sidebar-container' }, [
    h('header', { className: 'sidebar-header' }, [
      h('h1', null, 'Edge.AI Sidekick'),
      h('div', { className: 'status-pill' }, status)
    ]),
    // Here we would render the ChatInterface component
    // For this implementation, we'll assume it's adapted for the sidebar
    h('div', { className: 'chat-wrapper' }, [
       currentPage ? h('div', { className: 'page-info' }, [
         h('span', null, `📄 ${currentPage.title}`)
       ]) : null,
       // Render ChatInterface here
       h('div', { id: 'chat-interface-container' }, 'Cargando interfaz de chat...')
    ])
  ]);
}

render(h(SidebarApp), document.getElementById('app-root'));
