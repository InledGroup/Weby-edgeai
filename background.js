// background.js - Open Side Panel on icon click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.runtime.onInstalled.addListener(() => {
  console.log('Edge.AI Sidekick extension installed.');
});

// Proxy messages from content scripts to sidepanel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PAGE_CONTENT_EXTRACTED') {
    // Forward to sidepanel
    chrome.runtime.sendMessage(message).catch(() => {
      // Sidepanel might not be open, that's fine
    });
  }
});
