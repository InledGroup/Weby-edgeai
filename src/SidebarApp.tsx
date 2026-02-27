import { useState, useEffect } from 'preact/hooks';
import { Menu, X, ChevronRight, Settings, RefreshCw, FileText } from 'lucide-preact';
import { Sidebar } from '@/components/Sidebar';
import { ChatInterface } from '@/components/chat/ChatInterface';
import { ModelLoadingIndicator } from '@/components/ModelLoadingIndicator';
import { RAGSettingsPopup } from '@/components/RAGSettings';
import { ExportChatbotModal } from '@/components/ExportChatbotModal';
import { ExtensionStatus } from '@/components/ExtensionStatus';
import { FirstRunWizard } from '@/components/FirstRunWizard';
import { MemoryNotificationContainer } from '@/components/MemoryManager';
import { PrivacySettings } from '@/components/PrivacySettings';
import { DocumentViewer } from '@/components/DocumentViewer';
import { initializeStores, modelsReady, uiSignal, uiStore, documentsStore, chatModeSignal, conversationsStore, documentsSignal } from '@/lib/stores';
import { autoLoadModels } from '@/lib/ai/model-loader';
import { hasCompletedSetup } from '@/lib/ai/model-settings';
import { processDocument } from '@/lib/rag/rag-pipeline';
import { createDocument, deleteDocument } from '@/lib/db/documents';
import EngineManager from '@/lib/ai/engine-manager';
import { generateUUID } from '@/lib/utils';
import { i18nStore } from '@/lib/stores/i18n';

export function SidebarApp() {
  const [currentPage, setCurrentPage] = useState<{ url: string; title: string; markdown: string } | null>(null);
  const [indexingStatus, setIndexingStatus] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  // Subscribe to signals
  const theme = uiSignal.value.theme;
  const showPrivacy = uiSignal.value.showPrivacySettings;

  useEffect(() => {
    async function init() {
      try {
        await initializeStores();
        
        // Ensure theme is applied
        document.documentElement.setAttribute('data-theme', uiStore.theme);

        if (!hasCompletedSetup()) {
          setShowWizard(true);
        } else {
          const loaded = await autoLoadModels((type, progress, message) => {
            console.log(`📦 [Sidekick] ${type}: ${progress}% - ${message}`);
          });
          if (!loaded) setShowWizard(true);
        }
        setIsReady(true);
      } catch (err) {
        console.error('❌ [SidebarApp] Init Error:', err);
      }
    }
    init();

    const messageListener = (message: any) => {
      if (message.type === 'PAGE_CONTENT_EXTRACTED') {
        handlePageContent(message.data);
      }
    };
    chrome.runtime.onMessage.addListener(messageListener);
    
    const requestContent = () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (activeTab?.id && activeTab.url && !activeTab.url.startsWith('chrome://')) {
          chrome.tabs.sendMessage(activeTab.id, { type: 'REQUEST_PAGE_CONTENT' }).catch(() => {});
        }
      });
    };

    requestContent();
    const tabListener = () => requestContent();
    chrome.tabs.onActivated.addListener(tabListener);

    return () => {
      chrome.runtime.onMessage.removeListener(messageListener);
      chrome.tabs.onActivated.removeListener(tabListener);
    };
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const handlePageContent = async (data: any) => {
    if (!modelsReady.value) return;
    if (currentPage?.url === data.url) return;

    setCurrentPage(data);
    setIndexingStatus('Indexando...');
    try {
      const oldPages = documentsSignal.value.filter(doc => (doc.metadata && doc.metadata.source === 'extension_sidebar'));
      for (const oldPage of oldPages) {
        try {
          await deleteDocument(oldPage.id);
          documentsStore.remove(oldPage.id);
        } catch (e) {
          console.warn('Failed to delete old page doc:', oldPage.id);
        }
      }

      const docMarkdown = `# ${data.title}\n\nURL: ${data.url}\n\n${data.markdown}`;
      const newDoc = await createDocument({
        name: `Web: ${data.title}`,
        type: 'markdown',
        content: docMarkdown,
        size: new Blob([docMarkdown]).size,
        metadata: {
          url: data.url,
          title: data.title,
          source: 'extension_sidebar'
        }
      });

      documentsStore.add(newDoc);

      const embeddingEngine = await EngineManager.getEmbeddingEngine();
      await processDocument(newDoc.id, docMarkdown, embeddingEngine, 512, (status) => {
        setIndexingStatus(`IA: ${Math.round(status.progress)}%`);
        if (status.stage === 'complete') {
          documentsStore.update(newDoc.id, { status: 'ready' });
        } else {
          documentsStore.update(newDoc.id, { status: 'processing' });
        }
      });
      
      chatModeSignal.value = 'local';
      setIndexingStatus(null);
    } catch (error) {
      console.error('❌ RAG Error:', error);
      setIndexingStatus('Error RAG');
    }
  };

  if (!isReady) return <div className="h-screen flex items-center justify-center bg-[var(--color-bg)] text-[var(--color-text)] font-medium">Iniciando Edge.AI...</div>;

  if (showWizard) {
    return (
      <div className="h-screen w-full bg-[var(--color-bg)] overflow-y-auto">
        <FirstRunWizard onComplete={() => setShowWizard(false)} />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg)] text-[var(--color-text)] overflow-hidden relative">
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[var(--color-bg)] relative z-10">
        <header className="flex-shrink-0 px-4 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-secondary)]/80 backdrop-blur-md flex justify-between items-center z-30">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setSidebarOpen(true)}
              className="p-1.5 rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-colors"
            >
              <Menu size={20} />
            </button>
            <h1 className="text-sm font-bold flex items-center gap-2">
              <img src="/inledai.svg" width={20} />
              <span className="hidden xs:inline">Edge.AI</span>
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {indexingStatus && (
              <div className="flex items-center gap-2 px-2 py-1 bg-blue-500/10 rounded-full border border-blue-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                <span className="text-[10px] text-blue-500 font-bold uppercase tracking-wider">{indexingStatus}</span>
              </div>
            )}
            <button 
              onClick={() => {
                setIndexingStatus('Buscando...');
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                  if (tabs[0]?.id) {
                    chrome.tabs.sendMessage(tabs[0].id, { type: 'REQUEST_PAGE_CONTENT' }).catch(() => {
                      setIndexingStatus('No lista');
                      setTimeout(() => setIndexingStatus(null), 2000);
                    });
                  }
                });
              }}
              className="p-1.5 rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-colors"
              title="Recargar"
            >
              <RefreshCw size={16} className={indexingStatus ? 'animate-spin' : ''} />
            </button>
            <button 
              onClick={() => {
                setShowWizard(true);
                setSidebarOpen(false);
              }}
              className="p-1.5 rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-colors text-[var(--color-text-tertiary)]"
            >
              <Settings size={16} />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-hidden relative">
          <ChatInterface />
        </main>
      </div>

      {/* Overlay Sidebar (Drawer style) */}
      {sidebarOpen && (
        <>
          <div 
            className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm animate-in fade-in duration-300"
            onClick={() => setSidebarOpen(false)}
          />
          <div 
            className="fixed inset-y-0 left-0 z-50 w-72 bg-[var(--color-bg-secondary)] shadow-2xl animate-in slide-in-from-left duration-300 border-r border-[var(--color-border)]"
          >
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)] bg-[var(--color-bg-tertiary)]/30">
                <div className="flex items-center gap-2">
                  <img src="/inledai.svg" width={24} />
                  <span className="font-bold">Edge.AI Menu</span>
                </div>
                <button 
                  onClick={() => setSidebarOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-[var(--color-bg-tertiary)] transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <Sidebar 
                  onShowModelWizard={() => {
                    setShowWizard(true);
                    setSidebarOpen(false);
                  }} 
                  onDocumentClick={(id) => {
                    setSelectedDocId(id);
                    setSidebarOpen(false);
                  }}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Overlays & Modals */}
      <ModelLoadingIndicator />
      <RAGSettingsPopup />
      <ExportChatbotModal />
      <ExtensionStatus />
      <MemoryNotificationContainer />
      {showPrivacy && <PrivacySettings />}
      {selectedDocId && (
        <DocumentViewer 
          documentId={selectedDocId} 
          onClose={() => setSelectedDocId(null)} 
        />
      )}
    </div>
  );
}
