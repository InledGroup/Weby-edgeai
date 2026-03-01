// ChatInterface - Complete chat interface with RAG & Specialized MCP Support

import { useState, useEffect, useRef } from 'preact/hooks';
import { Sparkles, AlertCircle, Server, History, Sliders, X, MoreVertical, Printer, FileDown, FileText, FileCode, Plus, Globe } from 'lucide-preact';
import { Message } from './Message';
import { ChatInput } from './ChatInput';
import { WebSearchProgress } from './WebSearchProgress';
import { UrlConfirmationModal } from './UrlConfirmationModal';
import { MarkdownRenderer } from '../ui/MarkdownRenderer';
import { cosineSimilarity } from '@/lib/rag/vector-search';
import { 
  conversationsStore, 
  modelsReady, 
  hasReadyDocuments, 
  canvasStore, 
  canvasSignal, 
  modelsStore, 
  generatingTitleIdSignal, 
  chatModeSignal, 
  canChat as canChatSignal,
  processingSignal,
  activeTabUrlSignal,
  activeTabFaviconSignal
} from '@/lib/stores';
import { i18nStore } from '@/lib/stores/i18n';
import { Message as MessageType } from '@/types';
import { completeRAGFlow } from '@/lib/rag/rag-pipeline';
import { semanticChunkText } from '@/lib/rag/semantic-chunking';
import EngineManager from '@/lib/ai/engine-manager';
import { WebLLMEngine } from '@/lib/ai/webllm-engine';
import { detectLoop } from '@/lib/ai/utils';
import { 
  addMessage, 
  getOrCreateConversation, 
  getConversation, 
  generateTitle, 
  updateConversationTitle, 
  aiGenerateTitle,
  createConversation
} from '@/lib/db/conversations';
import { getRAGSettings, getWebSearchSettings, getSetting, getUseAdvancedRAG, getGenerationSettings, updateGenerationSettings } from '@/lib/db/settings';
import { getMemories, addMemory } from '@/lib/db/memories';
import { WebRAGOrchestrator } from '@/lib/web-search';
import { generateUUID, cn } from '@/lib/utils';
import { speechService, isVoiceModeEnabled } from '@/lib/voice/speech-service';
import { mcpManager } from '@/lib/ai/mcp-manager';
import { processExtensionIntent, getExtensionsSystemPrompt } from '@/lib/insuite-utils';
import { extensionsStore, extensionsSignal, memoryNotificationSignal } from '@/lib/stores';
import { getWorkerPool } from '@/lib/workers';

// Helper functions moved out of component
const autoExtractMemory = async (userMsg: string, assistantRes: string) => {
  try {
    const chatEngine = await EngineManager.getChatEngine();
    
    // Prompt más inteligente que distingue entre AFIRMAR y PREGUNTAR
    const extractionPrompt = `### INSTRUCCIÓN DE MEMORIA ###
Tu tarea es identificar si el usuario está PROPORCIONANDO información personal nueva en su mensaje.

CONTEXTO ACTUAL:
Mensaje del Usuario: "${userMsg}"
Respuesta previa de la IA: "${assistantRes}"

REGLAS CRÍTICAS:
1. Si el usuario está PREGUNTANDO algo sobre sí mismo (ej: "¿cuántos años tengo?", "¿qué sabes de mí?"), responde ÚNICAMENTE: NONE.
2. Si el usuario está AFIRMANDO o CONFIRMANDO un dato nuevo (ej: "tengo 25 años", "mi ciudad es Madrid"), extráelo.
3. Responde en una frase breve en tercera persona (ej: "El usuario tiene 25 años").
4. Si NO hay información personal AFIRMADA, responde ÚNICAMENTE: NONE.
5. NO inventes datos ni asumas cosas que no se han dicho explícitamente.

DATO EXTRAÍDO:`;

    const result = await chatEngine.generateText([
      { role: 'user', content: extractionPrompt }
    ], { max_tokens: 60, temperature: 0.1 } as any);

    let memoryText = result.trim().replace(/^["']|["']$/g, '').replace(/^DATO EXTRAÍDO: /i, '');
    
    if (memoryText.toLowerCase().includes('hecho:')) {
      memoryText = memoryText.split(/hecho:/i)[1].trim();
    }

    if (memoryText && !memoryText.toUpperCase().includes('NONE') && memoryText.length > 4) {
      console.log('🧠 [Memory] Nuevo recuerdo detectado:', memoryText);
      const memory = await addMemory(memoryText, 'system');
      
      // Notificar al usuario con el Signal global
      memoryNotificationSignal.value = {
        id: generateUUID(),
        content: memoryText,
        memoryId: memory.id
      };
      
      setTimeout(() => {
        if (memoryNotificationSignal.value?.memoryId === memory.id) {
          memoryNotificationSignal.value = null;
        }
      }, 8000);
    }
  } catch (e) {
    console.warn('Memory extraction failed', e);
  }
};

const isDocumentGenerationRequest = (message: string): boolean => {
  const lowerMessage = message.toLowerCase().trim();
  const keywords = ['genera un documento', 'crea un documento', 'escribe un documento', 'redacta un documento', 'genera un informe', 'crea un informe'];
  return keywords.some(keyword => lowerMessage.includes(keyword)) || (message.length > 30 && /^(genera|crea|escribe|redacta)/i.test(message));
};

const markdownToHTML = (md: string) => {
  return md.replace(/^# (.*$)/gim, '<h1>$1</h1>').replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
};

const builtInApps = [
  { 
    id: 'inlinked', 
    name: 'InLinked', 
    iconUrl: 'https://hosted.inled.es/INLINKED.png', 
    instructions: 'Eres un experto en LinkedIn. Formatea el texto del usuario para maximizar el engagement. Usa negritas y listas. Al final, genera OBLIGATORIAMENTE la URL: https://insuite.inled.es/inlinked/?t=TU_TEXTO&client=edgeai',
    exampleUrl: 'https://insuite.inled.es/inlinked/?t={{text}}&client=edgeai'
  },
  { 
    id: 'inqr', 
    name: 'InQR', 
    iconUrl: 'https://hosted.inled.es/inqr.png', 
    instructions: 'Genera códigos QR. Si es texto o URL usa: https://insuite.inled.es/inqr/?type=text&v=VALOR&generatenow=true&client=edgeai. Si es WiFi usa: https://insuite.inled.es/inqr/?type=wifi&s=SSID&p=PASS&sec=WPA&generatenow=true&client=edgeai',
    exampleUrl: 'https://insuite.inled.es/inqr/?type=text&v={{text}}&generatenow=true&client=edgeai'
  }
];

export function ChatInterface() {
  const [messages, setMessages] = useState<MessageType[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentResponse, setCurrentResponse] = useState('');
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [webSearchProgress, setWebSearchProgress] = useState<{ step: any; progress: number; message?: string } | null>(null);
  const [pendingUrls, setPendingUrls] = useState<string[] | null>(null);
  const [confirmationResolver, setConfirmationResolver] = useState<((urls: string[] | null) => void) | null>(null);
  const [showOptionsMenu, setShowOptionsMenu] = useState(false);
  const [selectedText, setSelectedText] = useState<{ text: string, title: string, url: string, forceMode: 'prompt' | 'rag' } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);
  const streamingState = useRef({ spokenIndex: 0, buffer: '', isStreamingAudio: false, timer: null as any });

  const isModelsReady = modelsReady.value;
  const isHasDocs = hasReadyDocuments.value;
  const currentMode = chatModeSignal.value;
  const canChat = canChatSignal.value;

  // Listen for text selection from content script
  useEffect(() => {
    const handleMessage = (message: any) => {
      if (message.type === 'TEXT_SELECTED') {
        setSelectedText({
          text: message.data.text,
          title: message.data.title,
          url: message.data.url,
          forceMode: message.data.text.length > 2000 ? 'rag' : 'prompt'
        });
        
        // Focus chat input if possible (UI improvement)
        const input = document.querySelector('textarea');
        if (input) input.focus();
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowOptionsMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handlePrint = () => {
    setShowOptionsMenu(false);
    window.print();
  };

  const handleExportTxt = () => {
    setShowOptionsMenu(false);
    const content = messages.map(m => `[${m.role.toUpperCase()}] (${new Date(m.timestamp).toLocaleString()}):\n${m.content}\n`).join('\n---\n\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-export-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    setShowOptionsMenu(false);
    const data = JSON.stringify({
      conversationId: conversationsStore.activeId,
      exportedAt: new Date().toISOString(),
      messages: messages
    }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startAudioStreaming = () => {
    if (streamingState.current.timer) clearTimeout(streamingState.current.timer);
    streamingState.current = { spokenIndex: 0, buffer: '', isStreamingAudio: false, timer: setTimeout(() => { streamingState.current.isStreamingAudio = true; }, 4000) };
  };

  const processAudioChunk = (chunk: string) => {
    streamingState.current.buffer += chunk;
    if (streamingState.current.isStreamingAudio && isVoiceModeEnabled.value) {
       const text = streamingState.current.buffer.substring(streamingState.current.spokenIndex);
       const lastPunct = Math.max(text.lastIndexOf('.'), text.lastIndexOf('?'), text.lastIndexOf('!'));
       if (lastPunct !== -1) {
          const toSpeak = text.substring(0, lastPunct + 1);
          speechService.speakFragment(toSpeak, false);
          streamingState.current.spokenIndex += toSpeak.length;
       }
    }
  };
  
  const finishAudioStreaming = (fullText: string) => {
    if (streamingState.current.timer) clearTimeout(streamingState.current.timer);
    if (isVoiceModeEnabled.value) {
      if (streamingState.current.isStreamingAudio) speechService.speakFragment(streamingState.current.buffer.substring(streamingState.current.spokenIndex) || '', true);
      else speechService.speak(fullText);
    }
    streamingState.current.isStreamingAudio = false;
  };

  // Detect manual scroll to enable/disable autoscroll
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    // If we are within 100px of bottom, keep autoscrolling
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
    setShouldAutoScroll(isAtBottom);
  };
  
  useEffect(() => {
    getWebSearchSettings().then(s => setWebSearchEnabled(s.enableWebSearch));
    return () => speechService.stopSpeaking();
  }, []);

  useEffect(() => {
    if (shouldAutoScroll && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      if (isGenerating) {
        container.scrollTop = container.scrollHeight;
      } else {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth'
        });
      }
    }
  }, [messages, currentResponse, webSearchProgress, shouldAutoScroll, isGenerating]);

  const lastSyncedId = useRef<string | null>(null);

  useEffect(() => {
    const activeId = conversationsStore.activeId;
    
    // Sincronizar solo si la identidad de la conversación ha cambiado (switch de chat)
    // Esto evita que al terminar de generar (isGenerating: false) se sobrescriba
    // el estado local con un store que podría estar aún desincronizado.
    if (activeId !== lastSyncedId.current) {
      if (activeId) {
        const conv = conversationsStore.active;
        if (conv) setMessages(conv.messages || []);
        else setMessages([]);
      } else {
        setMessages([]);
      }
      lastSyncedId.current = activeId;
      
      // Si cambiamos de conversación, nos aseguramos de resetear estados de UI
      setIsGenerating(false);
      setCurrentResponse('');
      setWebSearchProgress(null);
    }
  }, [conversationsStore.activeId]);

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsGenerating(false);
    }
  };

  const handleOpenInCanvas = (content: string) => {
    canvasStore.open(markdownToHTML(content));
  };

  const handleRegenerate = async (msgId: string) => {
    if (isGenerating) return;

    const msgIndex = messages.findIndex(m => m.id === msgId);
    if (msgIndex === -1) return;

    // Find the associated user message
    let userMsg = null;
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userMsg = messages[i];
        break;
      }
    }

    if (!userMsg) return;

    // Remove the assistant message from state
    setMessages(prev => prev.filter(m => m.id !== msgId));
    
    // Re-trigger sending (this will add a new assistant message)
    handleSendMessage(userMsg.content, 'local', userMsg.images);
  };

  const handleSendMessage = async (content: string, mode: 'web' | 'local' | 'smart' | 'conversation', images?: string[], activeTool?: { type: 'app' | 'mcp', id: string, name: string } | null) => {
    const isModelsReady = modelsReady.value;
    if (!isModelsReady) { alert(i18nStore.t('chat.loadModelsFirst')); return; }

    setIsGenerating(true);
    setCurrentResponse('');
    setWebSearchProgress(null);
    startAudioStreaming();

    // Reset and initialize AbortController
    if (abortControllerRef.current) abortControllerRef.current.abort();
    abortControllerRef.current = new AbortController();
    const abortSignal = abortControllerRef.current.signal;

    let assistantId = generateUUID();

    try {
      // 1. Pre-crear o asegurar ID de conversación antes de tocar el estado de mensajes
      let conversationId = conversationsStore.activeId;
      let isFirstMessage = false;

      if (!conversationId) {
        const conv = await getOrCreateConversation();
        conversationId = conv.id;
        isFirstMessage = true;
        conversationsStore.add(conv);
        conversationsStore.setActive(conversationId); // Activar ANTES de empezar a generar
      } else {
        const activeConv = conversationsStore.active;
        if (!activeConv || !activeConv.messages || activeConv.messages.length === 0) {
          isFirstMessage = true;
        }
      }

      // Load latest global settings before processing
      const genSettings = await getGenerationSettings();
      const ragSettings = await getRAGSettings();
      const hWeight = genSettings.historyWeight;
      const fThreshold = genSettings.faithfulnessThreshold;
      const cWindow = ragSettings.chunkWindowSize;
      const tK = ragSettings.topK;

      const originalContent = content; 
      let assistantPrompt = content;   
      let effectiveMode = mode;

      // Handle Selected Text Context (Temporary Exclusive Source)
      if (selectedText) {
        if (selectedText.forceMode === 'prompt') {
          assistantPrompt = `CONTEXTO DEL TEXTO SELECCIONADO (Fuente Única):\n"""\n${selectedText.text}\n"""\n\nPregunta: ${content}`;
          effectiveMode = 'conversation'; // Send directly to LLM with the context in the prompt
        } else {
          // RAG mode for selection
          setWebSearchProgress({ step: 'searching', progress: 10, message: 'Analizando selección...' });
          const embeddingEngine = await EngineManager.getEmbeddingEngine();
          
          // Chunk selection on the fly
          const chunks = semanticChunkText(selectedText.text, 600);
          setWebSearchProgress({ step: 'searching', progress: 30, message: `Indexando ${chunks.length} fragmentos...` });
          
          // Generate embeddings for selection chunks
          const chunkTexts = chunks.map(c => c.content);
          const chunkEmbeddings = await embeddingEngine.generateEmbeddingsBatch(chunkTexts, 4);
          
          // Search within selection chunks
          const queryEmbedding = await embeddingEngine.generateEmbedding(content);
          const scored = chunks.map((c, i) => ({
            content: c.content,
            score: cosineSimilarity(queryEmbedding, chunkEmbeddings[i])
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
          
          const selectionContext = scored.map((s, i) => `[Doc ${i+1}]: ${s.content}`).join('\n\n');
          assistantPrompt = `CONTEXTO SELECCIONADO (Procesado vía RAG):\n${selectionContext}\n\nPregunta: ${content}`;
          effectiveMode = 'conversation';
          setWebSearchProgress(null);
        }
        
        // Clear selection after use
        setSelectedText(null);
      }

      // Reset active tool in store if it was used
      if (activeTool) {
        extensionsStore.setActiveTool(null);
      }

      // Detect MCP Trigger (Pill or Slash command or Keyword)
      let mcpTools: any[] = [];
      let activeServerName = '';
      const toolNameMap = new Map<string, string>();

      let serverToUse = (activeTool?.type === 'mcp') ? activeTool.name : null;
      
      if (!serverToUse) {
        const mcpMatch = content.match(/\/(\w+)/);
        serverToUse = mcpMatch ? mcpMatch[1] : null;
      }

      // Auto-detection by keyword if no slash command
      if (!serverToUse) {
        const enabledServers = await mcpManager.getEnabledMCPServers();
        for (const s of enabledServers) {
          if (content.toLowerCase().includes(s.name.toLowerCase())) {
            serverToUse = s.name;
            break;
          }
        }
      }

      if (serverToUse) {
        activeServerName = serverToUse;
        const allTools = await mcpManager.getTools(activeServerName);
        
        if (allTools.length > 0) {
          // --- TOOL RAG: Filter relevant tools ---
          const queryKeywords = content.toLowerCase().split(/\s+/);
          const filteredTools = allTools.filter(t => {
            if (allTools.length <= 5) return true;
            const text = `${t.name} ${t.description}`.toLowerCase();
            return queryKeywords.some(kw => kw.length > 3 && text.includes(kw));
          }).slice(0, 5);

          const finalTools = filteredTools.length > 0 ? filteredTools : allTools.slice(0, 5);

          mcpTools = finalTools.map(t => {
            const modelToolName = `${t.serverName}__${t.name}`.replace(/-/g, '_');
            toolNameMap.set(modelToolName, t.name);
            
            const minifySchema = (schema: any) => {
              if (!schema) return undefined;
              const minified = { ...schema };
              if (minified.properties) {
                for (const key in minified.properties) {
                  delete minified.properties[key].title;
                  if (minified.properties[key].description) {
                    minified.properties[key].description = minified.properties[key].description.substring(0, 100);
                  }
                }
              }
              return minified;
            };

            return {
              type: 'function',
              function: {
                name: modelToolName, 
                description: (t.description || '').substring(0, 150),
                parameters: minifySchema(t.inputSchema || t.parameters)
              }
            };
          });
          if (content.trim() === `/${activeServerName}`) assistantPrompt = `Lista las herramientas de ${activeServerName}`;
          effectiveMode = 'conversation'; 
        }
      }

      const userMessage: MessageType = { 
        id: generateUUID(), 
        role: 'user', 
        content: originalContent, 
        images, 
        timestamp: Date.now(),
        metadata: activeTool ? { 
          appId: activeTool.type === 'app' ? activeTool.id : undefined,
          mcpServerId: activeTool.type === 'mcp' ? activeTool.id : undefined
        } : undefined
      };
      
      // Add user message to state and DB
      setMessages(prev => [...prev, userMessage]);
      await addMessage(conversationId, userMessage);

      // Actualizar título si es necesario
      if (isFirstMessage) {
        const tempTitle = generateTitle(originalContent);
        await updateConversationTitle(conversationId, tempTitle);
        const updatedConv = await getConversation(conversationId);
        if (updatedConv) conversationsStore.update(conversationId, updatedConv);
      }

      // Prepare temporary assistant message for streaming
      const tempAssistantMsg: MessageType = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        streaming: true
      };
      setMessages(prev => [...prev, tempAssistantMsg]);

      const chatEngine = await EngineManager.getChatEngine();
      const chatModelId = modelsStore.chat?.id;
      const memories = await getMemories();
      const memoryContext = memories.length > 0 ? `\n\nRECUERDOS:\n${memories.map(m => `- ${m.content}`).join('\n')}` : '';
      
      let canvasContext = '';
      if (canvasSignal.value.isOpen && canvasSignal.value.content) {
        canvasContext = `\n=== DOCUMENTO ABIERTO ===\n${canvasSignal.value.content.replace(/<[^>]*>/g, ' ').substring(0, 1000)}\n===`;
      }

      let finalContent = '';
      let finalSources: any[] | undefined = undefined;
      let finalMetadata: any = {};

      if (effectiveMode === 'web') {
        const embeddingEngine = await EngineManager.getEmbeddingEngine();
        const orchestrator = await WebRAGOrchestrator.create(chatEngine, embeddingEngine);
        
        // Calculate history for context
        const maxHistory = genSettings.historyLimit || 5;
        const history = messages.slice(-maxHistory).map(m => ({ role: m.role, content: m.content }));

        const res = await orchestrator.search(originalContent, {
          onToken: (t) => {
            if (abortSignal.aborted) return;
            finalContent += t;
            
            // Loop detection
            if (detectLoop(finalContent)) {
              console.warn('[Chat] Stopping generation due to loop detected');
              abortControllerRef.current?.abort();
              return;
            }

            setCurrentResponse(finalContent);
            processAudioChunk(t);
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: finalContent } : m));
          },
          onProgress: (step, progress, message) => {
            setWebSearchProgress({ step, progress, message });
          },
          conversationHistory: history, // Pass history for context
          additionalContext: canvasContext + memoryContext, // Pass memories and canvas
          confirmUrls: true,
          abortSignal, // Pass abortSignal
          onConfirmationRequest: async (urls) => {
            setPendingUrls(urls);
            return new Promise((resolve) => {
              setConfirmationResolver(() => (confirmedUrls: string[] | null) => {
                setPendingUrls(null);
                setConfirmationResolver(null);
                resolve(confirmedUrls || []);
              });
            });
          }
        });
        
        finalContent = res.answer;
        finalSources = res.ragResult.chunks;
        
        // Map chunks to unique web sources for UI component
        const uniqueSourcesMap = new Map<string, any>();
        res.ragResult.chunks.forEach(chunk => {
          const url = chunk.document.url;
          if (!uniqueSourcesMap.has(url) || uniqueSourcesMap.get(url).score < chunk.score) {
            uniqueSourcesMap.set(url, {
              title: chunk.document.title,
              url: url,
              score: chunk.score
            });
          }
        });

        // Pass accuracy metrics and web sources to metadata for UI
        finalMetadata = {
          ragQuality: res.ragQuality,
          ragMetrics: res.ragMetrics,
          faithfulness: res.faithfulness,
          webSources: Array.from(uniqueSourcesMap.values())
        };
      } else if (effectiveMode === 'local') {
        // Standard RAG Flow (Optimized)
        const embeddingEngine = await EngineManager.getEmbeddingEngine();
        let streamedText = '';
        
        // Dynamic history based on weight
        const maxHistory = Math.max(1, Math.round(hWeight * 20));
        const history = messages.slice(-maxHistory).map(m => ({ role: m.role, content: m.content }));

        // 1. Initial RAG Pass
        const result = await completeRAGFlow(assistantPrompt, embeddingEngine, chatEngine, tK, undefined, history, (c) => {
          if (abortSignal.aborted) return;
          streamedText += c;
          
          if (detectLoop(streamedText)) {
            console.warn('[Chat] Stopping generation due to loop detected');
            abortControllerRef.current?.abort();
            return;
          }

          setCurrentResponse(streamedText);
          processAudioChunk(c);
          setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: streamedText } : m));
        }, { 
          additionalContext: canvasContext + memoryContext,
          calculateMetrics: true,
          faithfulnessThreshold: fThreshold,
          chunkWindowSize: cWindow,
          abortSignal // Pass signal
        });

        let finalAnswer = result.answer;
        let finalChunks = result.ragResult.chunks;
        
        // 2. Check for 'Read More' pattern in the response
        if (!abortSignal.aborted) {
          const readMoreMatch = finalAnswer.match(/\((.*?)\)\.readmore=(\d+)/);
          if (readMoreMatch) {
            const [_, docName, lines] = readMoreMatch;
            setWebSearchProgress({ step: 'searching' as any, progress: 50, message: `Expandiendo lectura: ${docName}...` });
            
            const allDocs = await import('@/lib/db/documents').then(m => m.getAllDocuments());
            const targetDoc = allDocs.find(d => d.name.toLowerCase().includes(docName.toLowerCase()));
            
            if (targetDoc) {
              const extraK = Math.min(parseInt(lines) || 5, 10);
              const secondResult = await completeRAGFlow(assistantPrompt, embeddingEngine, chatEngine, tK + extraK, [targetDoc.id], history, (c) => {
                if (abortSignal.aborted) return;
                streamedText = c;
                
                if (detectLoop(streamedText)) {
                  console.warn('[Chat] Stopping generation due to loop detected');
                  abortControllerRef.current?.abort();
                  return;
                }

                setCurrentResponse(streamedText);
                setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: streamedText } : m));
              }, { 
                additionalContext: `\n\nINFO ADICIONAL DE ${targetDoc.name}:\nEl usuario (via comando) solicitó leer más. Aquí tienes contexto expandido. RE-ESCRIBE tu respuesta integrando estos nuevos datos.`,
                calculateMetrics: true,
                faithfulnessThreshold: fThreshold,
                chunkWindowSize: cWindow,
                abortSignal // Pass signal
              });
              
              finalAnswer = secondResult.answer;
              finalChunks = secondResult.ragResult.chunks;
            }
            setWebSearchProgress(null);
          }
        }

        finalContent = finalAnswer;
        finalSources = finalChunks;
        
        // Set metadata for UI indicators
        finalMetadata = {
          ragQuality: result.quality?.overall,
          ragMetrics: result.metrics,
          faithfulness: result.faithfulness
        };
      } else {
        // Conversation mode
        const maxHistory = Math.max(1, Math.round(hWeight * 20));
        const history = messages.slice(-maxHistory).map(m => ({ role: m.role, content: m.content }));
        
        let customAppPrompt = '';
        if (activeTool && activeTool.type === 'app') {
          const app = extensionsSignal.value.customApps.find(a => a.id === activeTool.id) || 
                      builtInApps.find(a => a.id === activeTool.id);
          if (app) {
            customAppPrompt = `\n\n=== PRIORIDAD CRÍTICA: APP SELECCIONADA: ${app.name} ===\nInstrucciones específicas: ${app.instructions}\nSolo genera la URL técnica para esta app. IGNORA cualquier otra herramienta.\nURL de ejemplo: ${app.exampleUrl || (app as any).url}`;
          }
        }
        
        const systemPrompt = `Eres un asistente inteligente local con memoria persistente.
${selectedText ? '### REGLA CRÍTICA: FUENTE ÚNICA ###\nEl usuario ha seleccionado un texto específico. Responde EXCLUSIVAMENTE basándote en ese texto proporcionado. IGNORA el resto del sitio web o documentos externos para esta respuesta.\n### FIN REGLA ###' : ''}
### DATOS IMPORTANTES DEL USUARIO (MEMORIA) ###
${memoryContext || 'No hay recuerdos previos.'}
### FIN DE MEMORIA ###

Instrucciones Críticas:
1. Revisa SIEMPRE la sección de MEMORIA antes de responder.
2. Si el usuario te pregunta por datos personales (como su edad, nombre, proyectos), búscalos en la sección de MEMORIA y responde con esa información.
3. Si el dato no está en la MEMORIA, di honestamente que no lo recuerdas.
4. ${canvasContext ? 'Tienes un documento abierto en el Canvas que debes tener en cuenta.' : ''}
5. ${getExtensionsSystemPrompt()}
6. ${customAppPrompt}`;
        
        // El historial NO incluye el mensaje actual que acabamos de enviar, así que lo añadimos explícitamente
        const chatMsgs = [
          { role: 'system', content: systemPrompt }, 
          ...history,
          { role: 'user', content: assistantPrompt } // Mensaje actual
        ];
        
        const isMcpIntent = mcpTools.length > 0 || content.match(/\/(notion|weather|google|search)/i);

        if (isMcpIntent && mcpTools.length > 0) {
           const useSpecialized = await getSetting('useSpecializedToolModel');
           const canHandleNative = chatEngine instanceof WebLLMEngine && chatModelId?.includes('8b');
           
           let toolEngine;
           if (useSpecialized && !canHandleNative) {
             if (!EngineManager.isToolEngineReady()) {
               setWebSearchProgress({ step: 'searching', progress: 0, message: 'Descargando modelo de herramientas...' });
               toolEngine = await EngineManager.getToolEngine((progress, msg) => {
                 setWebSearchProgress({ step: 'searching', progress, message: `Descargando: ${msg} (${Math.round(progress)}%)` });
               });
               setWebSearchProgress(null);
             } else {
               toolEngine = await EngineManager.getToolEngine();
             }
           } else {
             toolEngine = chatEngine;
           }
           
           let currentMsgs = [...chatMsgs];
           let loops = 0;
           let lastResContent = '';

           while (loops < 5 && !abortSignal.aborted) {
             let isToolCallDetected = false;
             let loopAccumulated = '';
             const res = await toolEngine.chat(currentMsgs, { 
               tools: mcpTools, 
               abortSignal, // Pass signal
               onStream: (c) => { 
                 if (abortSignal.aborted) return;
                 loopAccumulated += c;
                 
                 // Detect loop in accumulated text
                 if (detectLoop(loopAccumulated)) {
                   console.warn('[Chat] Stopping tool generation due to loop detected');
                   abortControllerRef.current?.abort();
                   return;
                 }

                 if (loopAccumulated.includes('{') || loopAccumulated.includes('###')) { 
                   isToolCallDetected = true; 
                   setCurrentResponse(''); 
                 }
                 if (!isToolCallDetected) { 
                   finalContent += c;
                   setCurrentResponse(finalContent);
                   processAudioChunk(c);
                   setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: finalContent } : m));
                 } 
               } 
             });

             if (!abortSignal.aborted && res.tool_calls && res.tool_calls.length > 0) {
                currentMsgs.push(res);
                const toolCallMsg = { id: generateUUID(), role: 'assistant', content: res.content || '', timestamp: Date.now(), tool_calls: res.tool_calls };
                setMessages(prev => [...prev.filter(m => m.id !== assistantId), toolCallMsg as any]);
                await addMessage(conversationId, toolCallMsg as any);
                
                for (const call of res.tool_calls) {
                   if (abortSignal.aborted) break;
                   const fakeName = call.function.name;
                   const realName = toolNameMap.get(fakeName) || fakeName;
                   setWebSearchProgress({ step: 'searching' as any, progress: 50, message: `Ejecutando ${realName}...` });
                   let result;
                   try {
                     let args = call.function.arguments;
                     if (typeof args === 'string') { try { args = JSON.parse(args); } catch (e) { args = { data: args }; } }
                     result = await mcpManager.callTool(activeServerName, realName, args);
                   } catch (e: any) { result = { error: e.message }; }
                   
                   const toolMsg = { id: generateUUID(), role: 'tool', content: JSON.stringify(result, null, 2), timestamp: Date.now(), metadata: { toolName: realName } };
                   currentMsgs.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
                   setMessages(prev => [...prev, toolMsg as any]);
                   await addMessage(conversationId, toolMsg as any);
                }
                
                // Prepare new assistant turn
                const nextId = generateUUID();
                setMessages(prev => [...prev, { id: nextId, role: 'assistant', content: '', timestamp: Date.now(), streaming: true }]);
                
                // @ts-ignore - Update assistantId for subsequent turns
                assistantId = nextId; 
                
                loops++;
                finalContent = '';
                setCurrentResponse('');
             } else {
                lastResContent = res.content || '';
                break;
             }
           }

           if (!abortSignal.aborted && loops > 0 && (!lastResContent || lastResContent.length < 5)) {
              await chatEngine.generateText(currentMsgs as any, { 
                abortSignal, // Pass signal
                onStream: (c) => { 
                if (abortSignal.aborted) return;
                finalContent += c;
                
                if (detectLoop(finalContent)) {
                  console.warn('[Chat] Stopping follow-up generation due to loop detected');
                  abortControllerRef.current?.abort();
                  return;
                }

                setCurrentResponse(finalContent); 
                processAudioChunk(c);
                // Need to find the latest assistant message to update
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last.role === 'assistant') return prev.map(m => m.id === last.id ? { ...m, content: last.content + c } : m);
                  return prev;
                });
              } });
           } else {
              finalContent = lastResContent;
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: finalContent, streaming: false } : m));
           }
        } else {
            await chatEngine.generateText(chatMsgs as any, { 
              abortSignal, // Pass signal
              onStream: (c) => { 
              if (abortSignal.aborted) return;
              finalContent += c;
              
              if (detectLoop(finalContent)) {
                console.warn('[Chat] Stopping generation due to loop detected');
                abortControllerRef.current?.abort();
                return;
              }

              setCurrentResponse(finalContent); 
              processAudioChunk(c);
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: finalContent } : m));
            } });
        }
      }

      // Finalize the message
      const finalizedAssistantMsg = { 
        id: assistantId, 
        role: 'assistant', 
        content: finalContent, 
        timestamp: Date.now(),
        sources: finalSources as any,
        streaming: false,
        metadata: finalMetadata
      };

      setMessages(prev => prev.map(m => m.id === assistantId ? finalizedAssistantMsg as any : m));
      setCurrentResponse('');
      setWebSearchProgress(null);
      finishAudioStreaming(finalContent);
      
      // Save to DB using the PRE-GENERATED ID
      await addMessage(conversationId, {
        id: assistantId,
        role: 'assistant',
        content: finalContent,
        sources: finalSources,
        metadata: finalMetadata
      });

      // Refresh conversation list/title in background
      if (isFirstMessage) {
        generatingTitleIdSignal.value = conversationId!;
        aiGenerateTitle(originalContent).then(async (aiTitle) => {
          await updateConversationTitle(conversationId!, aiTitle);
          const updated = await getConversation(conversationId!);
          if (updated) conversationsStore.update(conversationId!, updated);
        }).catch(err => console.error("Title generation failed", err))
          .finally(() => {
            generatingTitleIdSignal.value = null;
          });
      } else {
        const updated = await getConversation(conversationId);
        if (updated) conversationsStore.update(conversationId, updated);
      }

      // Handlers for document generation or extension intent
      if (isDocumentGenerationRequest(originalContent)) {
        canvasStore.open(markdownToHTML(finalContent));
      }
      setTimeout(() => processExtensionIntent(finalContent, activeTool?.id), 500);

      // Auto-extract memory in background
      setTimeout(() => autoExtractMemory(originalContent, finalContent), 1000);

    } catch (error: any) {
      if (error.name === 'AbortError' || abortSignal.aborted) {
        console.log('[Chat] Generation aborted by user');
      } else {
        console.error(error);
        setMessages(prev => [...prev.filter(m => m.id !== assistantId), { id: generateUUID(), role: 'assistant', content: 'Error: ' + error.message, timestamp: Date.now() }]);
      }
    } finally { 
      setIsGenerating(false); 
      abortControllerRef.current = null;
    }
  }

  return (
    <div className="flex flex-col h-full bg-[var(--color-bg)] overflow-hidden min-h-0">
      {/* Chat Header with Current Page Info & Options */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 backdrop-blur-md flex justify-between items-center z-10 min-h-[52px]">
        <div className="flex items-center gap-3 overflow-hidden">
          {/* Current Page Info (Favicon + URL) */}
          <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)] max-w-[240px] overflow-hidden group">
            {activeTabFaviconSignal.value ? (
              <img src={activeTabFaviconSignal.value} className="w-4 h-4 rounded-sm flex-shrink-0" />
            ) : (
              <Globe size={14} className="text-[var(--color-text-tertiary)] flex-shrink-0" />
            )}
            <div className="text-[10px] font-medium text-[var(--color-text-secondary)] truncate">
              {activeTabUrlSignal.value ? new URL(activeTabUrlSignal.value).hostname : 'Weby'}
            </div>
          </div>
          
          <div className="h-4 w-[1px] bg-[var(--color-border)] hidden sm:block"></div>
          
          <div className="text-xs font-semibold text-[var(--color-text)] truncate max-w-[150px]">
            {conversationsStore.active?.title || i18nStore.t('common.conversations')}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {/* New Chat Button */}
          <button
            onClick={async () => {
              const url = activeTabUrlSignal.value;
              const favicon = activeTabFaviconSignal.value;
              const conversation = await createConversation(i18nStore.t('common.newConversation'), undefined, url || undefined, favicon || undefined);
              conversationsStore.add(conversation);
              conversationsStore.setActive(conversation.id);
            }}
            className="p-1.5 rounded-lg hover:bg-[var(--color-primary)] hover:text-black text-[var(--color-text-tertiary)] transition-all"
            title={i18nStore.t('common.newConversation')}
          >
            <Plus size={18} />
          </button>

          <div className="relative chat-header-actions" ref={menuRef}>
            <button
              onClick={() => setShowOptionsMenu(!showOptionsMenu)}
              className="p-1.5 rounded-lg hover:bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text)] transition-all"
              title={i18nStore.t('chat.moreActions')}
            >
              <MoreVertical size={18} />
            </button>

            {showOptionsMenu && (
              <div className="absolute right-0 mt-2 w-56 bg-[var(--color-bg-secondary)] border border-[var(--color-border)] rounded-xl shadow-xl z-50 animate-in fade-in slide-in-from-top-2 duration-200 overflow-hidden">
                <div className="p-1.5 space-y-0.5">
                  <button
                    onClick={handlePrint}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-hover)] rounded-lg transition-colors text-left"
                  >
                    <Printer size={16} />
                    <span>{i18nStore.t('chat.print')}</span>
                  </button>
                  
                  <div className="h-[1px] bg-[var(--color-border)] my-1 mx-1" />
                  
                  <div className="px-3 py-1.5 text-[10px] font-bold text-[var(--color-text-tertiary)] uppercase tracking-wider">
                    {i18nStore.t('chat.export')}
                  </div>
                  
                  <button
                    onClick={handleExportTxt}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-hover)] rounded-lg transition-colors text-left"
                  >
                    <FileText size={16} />
                    <span>{i18nStore.t('chat.exportTxt')}</span>
                  </button>
                  
                  <button
                    onClick={handleExportJson}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-hover)] rounded-lg transition-colors text-left"
                  >
                    <FileCode size={16} />
                    <span>{i18nStore.t('chat.exportJson')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 max-w-3xl mx-auto w-full custom-scrollbar"
        style={{ overscrollBehavior: 'contain' }}
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
            <img src="/inledai.svg" width={64} className="animate-in zoom-in duration-500" />
            
            {processingSignal.value ? (
              <div className="flex flex-col items-center space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-500">
                <div className="relative">
                  <div className="w-12 h-12 rounded-full border-2 border-[var(--color-border)] border-t-[#00fefe] animate-spin"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[10px] font-bold">{Math.round(processingSignal.value.progress)}%</span>
                  </div>
                </div>
                <div>
                  <h3 className="text-lg font-bold">{i18nStore.t('common.processing')}...</h3>
                  <p className="text-sm text-[var(--color-text-tertiary)]">{processingSignal.value.message}</p>
                </div>
              </div>
            ) : !isModelsReady ? (
               <div className="flex flex-col items-center space-y-3">
                 <div className="w-8 h-8 rounded-full border-2 border-[var(--color-border)] border-t-[#00fefe] animate-spin opacity-50"></div>
                 <h3 className="text-lg font-bold">{i18nStore.t('chat.loadingModels')}</h3>
               </div>
            ) : (
              <>
                <h3 className="text-xl font-bold">{i18nStore.t('chat.welcome')}</h3>
                {!canChat && <p className="text-sm text-amber-500 mt-2">{i18nStore.t('chat.stepsRequired')}</p>}
              </>
            )}
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map(m => {
              if (!m) return null;
              if (m.role === 'tool') {
                return (
                  <div key={m.id} className="flex justify-center animate-in fade-in slide-in-from-top-2">
                                          <div className="max-w-2xl w-full bg-[var(--color-bg-tertiary)]/40 border border-[var(--color-border)] rounded-xl p-4 shadow-sm">
                                            <div className="flex items-center gap-2 text-[var(--color-text-tertiary)] text-[10px] font-bold uppercase tracking-widest mb-2">
                                              <Server size={12} className="text-[#00fefe]" />
                                              <span>{i18nStore.t('mcp.toolResult').replace('{name}', (m.metadata?.toolName || 'Herramienta').toUpperCase())}</span>
                                            </div>
                                            <pre className="text-[11px] font-mono text-[var(--color-text-secondary)] overflow-x-auto whitespace-pre-wrap max-h-40 leading-relaxed custom-scrollbar">                        {m.content}
                      </pre>
                    </div>
                  </div>
                );
              }
              if (m.role === 'assistant' && (m as any).tool_calls) {
                 const calls = (m as any).tool_calls;
                 // If there's no content, only show the pill
                 return (
                   <div key={m.id} className="space-y-4">
                     {m.content && <Message message={m} onOpenInCanvas={handleOpenInCanvas} />}
                                            <div className="flex justify-center">
                                              <div className="flex items-center gap-2.5 px-4 py-2 bg-blue-500/5 border border-blue-500/20 rounded-full shadow-sm animate-pulse">
                                                <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                                                <span className="text-xs font-semibold text-blue-500">
                                                  {i18nStore.t('mcp.using').replace('{name}', calls.map((t:any) => t.function.name.split('__')[1] || t.function.name).join(', '))}
                                                </span>
                                              </div>
                                            </div>                   </div>
                 );
              }
              
              return <Message key={m.id} message={m} onOpenInCanvas={handleOpenInCanvas} onRegenerate={() => handleRegenerate(m.id)} />;
            })}
            {webSearchProgress && <div className="px-10"><WebSearchProgress {...webSearchProgress} /></div>}
            <div ref={messagesEndRef} className="h-4" />
          </div>
        )}
      </div>
      <div className="flex-shrink-0 p-4 border-t border-[var(--color-border)] bg-[var(--color-bg)]/80 backdrop-blur-md">
        <div className="max-w-3xl mx-auto">
          {selectedText && (
            <div className="mb-3 p-3 bg-[var(--color-bg-secondary)] border border-[var(--color-primary)]/40 rounded-xl animate-in slide-in-from-bottom-2 shadow-sm border-l-4 border-l-[var(--color-primary)]">
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-[var(--color-primary)]" />
                  <span className="text-xs font-bold text-[var(--color-text)]">Contexto de Selección</span>
                </div>
                <button 
                  onClick={() => setSelectedText(null)} 
                  className="p-1 hover:bg-[var(--color-bg-hover)] rounded-md transition-colors"
                  title="Eliminar selección"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="text-[10px] text-[var(--color-text-secondary)] line-clamp-2 mb-2 italic px-1 leading-relaxed border-l-2 border-[var(--color-border)] ml-1">
                "{selectedText.text}"
              </div>
              <div className="flex items-center justify-between gap-4 mt-1">
                <div className="flex bg-[var(--color-bg-tertiary)] rounded-lg p-0.5 border border-[var(--color-border)] shadow-inner">
                  <button 
                    onClick={() => setSelectedText({...selectedText, forceMode: 'prompt'})}
                    className={cn(
                      "px-3 py-1 text-[9px] font-bold rounded-md transition-all flex flex-col items-center",
                      selectedText.forceMode === 'prompt' ? "bg-[var(--color-primary)] text-black shadow-sm" : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                    )}
                  >
                    <span>CONVERSACIÓN</span>
                    {selectedText.text.length <= 2000 && <span className="text-[7px] opacity-70">Recomendado</span>}
                  </button>
                  <button 
                    onClick={() => setSelectedText({...selectedText, forceMode: 'rag'})}
                    className={cn(
                      "px-3 py-1 text-[9px] font-bold rounded-md transition-all flex flex-col items-center",
                      selectedText.forceMode === 'rag' ? "bg-[var(--color-primary)] text-black shadow-sm" : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
                    )}
                  >
                    <span>RAG SELECCIÓN</span>
                    {selectedText.text.length > 2000 && <span className="text-[7px] opacity-70">Recomendado</span>}
                  </button>
                </div>
                <div className="text-[9px] font-medium px-2 py-0.5 bg-[var(--color-bg-tertiary)] text-[var(--color-text-tertiary)] rounded-full border border-[var(--color-border)]">
                  {selectedText.text.length} caracteres
                </div>
              </div>
            </div>
          )}
          <ChatInput 
            onSend={handleSendMessage} 
            onStop={handleStopGeneration}
            disabled={!canChat} 
            loading={isGenerating} 
            supportsVision={!!modelsStore.chat?.requiresGPU}
            onWebSearchToggle={(enabled) => setWebSearchEnabled(enabled)}
          />
        </div>
      </div>
      {pendingUrls && confirmationResolver && <UrlConfirmationModal urls={pendingUrls} onConfirm={confirmationResolver} onCancel={() => confirmationResolver(null)} />}
    </div>
  );
}
