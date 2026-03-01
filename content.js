// content.js - Extract DOM and send MD to extension
function extractAndSendContent() {
  try {
    if (typeof TurndownService === 'undefined') {
      console.error('[Edge.AI] TurndownService is not defined. Ensure turndown.js is loaded.');
      return;
    }

    const turndownService = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced'
    });

    // Remove script and style elements from the clone to get cleaner MD
    const bodyClone = document.body.cloneNode(true);
    const elementsToRemove = bodyClone.querySelectorAll('script, style, nav, footer, header, noscript, iframe, .ads, [role="complementary"]');
    elementsToRemove.forEach(el => el.remove());

    const markdown = turndownService.turndown(bodyClone.innerHTML);
    const title = document.title;
    const url = window.location.href;

    if (!markdown || markdown.length < 50) {
      console.warn('[Edge.AI] Content too short, skipping send.');
      return;
    }

    console.log('[Edge.AI] Content extracted, length:', markdown.length);

    chrome.runtime.sendMessage({
      type: 'PAGE_CONTENT_EXTRACTED',
      data: {
        markdown,
        title,
        url,
        timestamp: Date.now()
      }
    }).catch(err => console.debug('[Edge.AI] Sidebar likely closed, cannot send content.'));
  } catch (e) {
    console.error('[Edge.AI] Extraction failed:', e);
  }
}

// Selection handling
let selectionButton = null;
let lastSelectedText = '';

function createSelectionButton() {
  const btn = document.createElement('div');
  btn.id = 'weby-selection-button';
  const logoUrl = chrome.runtime.getURL('inledai.svg');
  
  btn.innerHTML = `
    <img src="${logoUrl}" style="width: 24px !important; height: 24px !important; pointer-events: none !important; display: block !important;" />
  `;
  
  btn.style.cssText = `
    position: fixed !important;
    z-index: 2147483647 !important;
    background: #1a1a1a !important;
    border: 1px solid #00FEFE !important;
    border-radius: 8px !important;
    padding: 6px !important;
    cursor: pointer !important;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5) !important;
    display: none !important;
    transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275) !important;
    pointer-events: auto !important;
    width: 36px !important;
    height: 36px !important;
    box-sizing: border-box !important;
    margin: 0 !important;
    align-items: center !important;
    justify-content: center !important;
  `;
  
  btn.onmouseover = () => btn.style.transform = 'scale(1.1)';
  btn.onmouseout = () => btn.style.transform = 'scale(1)';
  
  // CRITICAL: Stop propagation on mousedown to prevent document-level handlers from hiding the button
  btn.onmousedown = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[Edge.AI] Selection button clicked');
    if (lastSelectedText) {
      chrome.runtime.sendMessage({
        type: 'TEXT_SELECTED',
        data: {
          text: lastSelectedText,
          url: window.location.href,
          title: document.title
        }
      });
      btn.style.setProperty('display', 'none', 'important');
      window.getSelection().removeAllRanges();
    }
  };
  
  document.body.appendChild(btn);
  return btn;
}

function handleSelectionChange() {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();
  
  if (selectedText.length > 0) {
    lastSelectedText = selectedText;
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    if (rect.width === 0 || rect.height === 0) return;

    if (!selectionButton) selectionButton = createSelectionButton();
    
    let top = rect.top - 45;
    let left = rect.left + (rect.width / 2) - 18;
    
    if (top < 10) top = rect.bottom + 10;
    if (left < 10) left = 10;
    if (left > window.innerWidth - 50) left = window.innerWidth - 50;
    
    selectionButton.style.top = top + 'px';
    selectionButton.style.left = left + 'px';
    selectionButton.style.setProperty('display', 'flex', 'important');

    console.log('[Edge.AI] Selection detected, showing button');
  } else {
    if (selectionButton) selectionButton.style.setProperty('display', 'none', 'important');
  }
}

document.addEventListener('mouseup', (e) => {
  if (selectionButton && selectionButton.contains(e.target)) return;
  setTimeout(handleSelectionChange, 50);
});

document.addEventListener('keyup', (e) => {
  if (e.shiftKey) {
    setTimeout(handleSelectionChange, 50);
  }
});

document.addEventListener('mousedown', (e) => {
  if (selectionButton && !selectionButton.contains(e.target)) {
    selectionButton.style.setProperty('display', 'none', 'important');
  }
});

// Extract content when requested
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REQUEST_PAGE_CONTENT') {
    extractAndSendContent();
    sendResponse({ success: true });
  }
});

if (document.readyState === 'complete') {
  extractAndSendContent();
} else {
  window.addEventListener('load', extractAndSendContent);
}
