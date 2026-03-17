// background.js — Service worker for Skill Recorder extension
// Handles: recording state, navigation events, event aggregation, backend communication

let allEvents = [];
let recording = false;
let currentIntent = '';

const BACKEND_URL = 'http://localhost:3000';

// --- Open side panel on extension icon click ---

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// --- Message handling ---

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_RECORDING') {
    recording = true;
    currentIntent = msg.intent || '';
    allEvents = [];

    // Notify all tabs to start recording
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { type: 'START_RECORDING' }).catch(() => {});
      }
    });
    sendResponse({ ok: true });
    return true;
  }

  if (msg.type === 'STOP_RECORDING') {
    recording = false;

    // Notify all tabs to stop recording
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { type: 'STOP_RECORDING' }).catch(() => {});
      }
    });
    sendResponse({ ok: true, eventCount: allEvents.length });
    return true;
  }

  // Aggregate events from content scripts
  if (msg.type === 'EVENT' && recording) {
    allEvents.push(msg.payload);

    // Forward to side panel for live display
    chrome.runtime.sendMessage({
      type: 'NEW_EVENT',
      payload: msg.payload,
      totalCount: allEvents.length
    }).catch(() => {});
  }

  // Get current events (for side panel)
  if (msg.type === 'GET_EVENTS') {
    sendResponse({ intent: currentIntent, events: allEvents, recording });
    return true;
  }

  // Submit to backend for LLM processing
  if (msg.type === 'GENERATE_SKILL') {
    processWithBackend()
      .then((result) => {
        chrome.runtime.sendMessage({
          type: 'SKILL_RESULT',
          skill: result.skill,
          mcpTool: result.mcpTool || null
        }).catch(() => {});
      })
      .catch((err) => {
        chrome.runtime.sendMessage({
          type: 'SKILL_ERROR',
          error: err.message
        }).catch(() => {});
      });
    sendResponse({ ok: true, processing: true });
    return true;
  }

  // Export as MCP tool
  if (msg.type === 'EXPORT_MCP') {
    exportMcp(msg.skill)
      .then((result) => {
        chrome.runtime.sendMessage({
          type: 'MCP_RESULT',
          mcpTool: result
        }).catch(() => {});
      })
      .catch((err) => {
        chrome.runtime.sendMessage({
          type: 'MCP_ERROR',
          error: err.message
        }).catch(() => {});
      });
    sendResponse({ ok: true });
    return true;
  }
});

// --- Navigation events via webNavigation API ---

chrome.webNavigation.onCommitted.addListener((details) => {
  if (!recording) return;
  if (details.frameId !== 0) return; // main frame only

  const isBackForward = details.transitionQualifiers?.includes('forward_back') || false;

  const event = {
    seq: allEvents.length + 1,
    timestamp: new Date().toISOString(),
    type: 'navigation',
    url: details.url,
    tab_id: details.tabId,
    transition_type: details.transitionType,
    is_back_forward: isBackForward
  };

  allEvents.push(event);

  chrome.runtime.sendMessage({
    type: 'NEW_EVENT',
    payload: event,
    totalCount: allEvents.length
  }).catch(() => {});
});

// --- Tab events ---

chrome.tabs.onActivated.addListener((activeInfo) => {
  if (!recording) return;
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError) return;

    const event = {
      seq: allEvents.length + 1,
      timestamp: new Date().toISOString(),
      type: 'tab_switch',
      tab_id: activeInfo.tabId,
      url: tab?.url || null,
      page_title: tab?.title || null
    };

    allEvents.push(event);

    chrome.runtime.sendMessage({
      type: 'NEW_EVENT',
      payload: event,
      totalCount: allEvents.length
    }).catch(() => {});
  });
});

chrome.tabs.onCreated.addListener((tab) => {
  if (!recording) return;

  const event = {
    seq: allEvents.length + 1,
    timestamp: new Date().toISOString(),
    type: 'tab_created',
    tab_id: tab.id,
    url: tab.pendingUrl || tab.url || null
  };

  allEvents.push(event);

  // Inject content script into new tab
  if (tab.id) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    }).catch(() => {});
  }
});

// --- Keyboard shortcut ---

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-recording') {
    if (recording) {
      recording = false;
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, { type: 'STOP_RECORDING' }).catch(() => {});
        }
      });
      chrome.runtime.sendMessage({ type: 'RECORDING_STOPPED' }).catch(() => {});
    } else {
      recording = true;
      allEvents = [];
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, { type: 'START_RECORDING' }).catch(() => {});
        }
      });
      chrome.runtime.sendMessage({ type: 'RECORDING_STARTED' }).catch(() => {});
    }
  }
});

// --- Backend communication ---

async function processWithBackend() {
  const response = await fetch(`${BACKEND_URL}/api/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      intent: currentIntent,
      events: allEvents
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend error (${response.status}): ${text}`);
  }

  return response.json();
}

async function exportMcp(skill) {
  const response = await fetch(`${BACKEND_URL}/api/export-mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Backend error (${response.status}): ${text}`);
  }

  return response.json();
}
