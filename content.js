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

// Extract content when requested
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'REQUEST_PAGE_CONTENT') {
    extractAndSendContent();
    sendResponse({ success: true });
  }
});

// Also extract on load (optional, but good for immediate readiness)
if (document.readyState === 'complete') {
  extractAndSendContent();
} else {
  window.addEventListener('load', extractAndSendContent);
}
