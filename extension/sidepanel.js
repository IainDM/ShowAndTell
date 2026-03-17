// sidepanel.js — Side panel logic for Skill Recorder

const intentInput = document.getElementById('intent');
const recordBtn = document.getElementById('record-btn');
const stopBtn = document.getElementById('stop-btn');
const generateBtn = document.getElementById('generate-btn');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const eventCount = document.getElementById('event-count');
const eventList = document.getElementById('event-list');
const outputSection = document.getElementById('output-section');
const skillOutput = document.getElementById('skill-output');
const copyBtn = document.getElementById('copy-btn');
const exportMcpBtn = document.getElementById('export-mcp-btn');
const mcpSection = document.getElementById('mcp-section');
const mcpOutput = document.getElementById('mcp-output');
const copyMcpBtn = document.getElementById('copy-mcp-btn');

let totalEvents = 0;
let generatedSkill = '';

// --- Button handlers ---

recordBtn.addEventListener('click', () => {
  const intent = intentInput.value.trim();
  if (!intent) {
    intentInput.focus();
    intentInput.style.borderColor = '#e53935';
    setTimeout(() => { intentInput.style.borderColor = ''; }, 1500);
    return;
  }

  chrome.runtime.sendMessage({ type: 'START_RECORDING', intent }, () => {
    recordBtn.disabled = true;
    stopBtn.disabled = false;
    generateBtn.disabled = true;
    intentInput.disabled = true;
    eventList.innerHTML = '';
    totalEvents = 0;
    eventCount.textContent = '(0)';
    outputSection.style.display = 'none';
    mcpSection.style.display = 'none';

    statusIndicator.className = 'recording';
    statusText.textContent = 'Recording...';
  });
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (response) => {
    recordBtn.disabled = false;
    stopBtn.disabled = true;
    intentInput.disabled = false;

    if (response && response.eventCount > 0) {
      generateBtn.disabled = false;
    }

    statusIndicator.className = '';
    statusText.textContent = `Stopped — ${totalEvents} events captured`;
  });
});

generateBtn.addEventListener('click', () => {
  generateBtn.disabled = true;
  statusIndicator.className = 'processing';
  statusText.textContent = 'Generating skill...';

  chrome.runtime.sendMessage({ type: 'GENERATE_SKILL' });
});

copyBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(generatedSkill).then(() => {
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy SKILL.md'; }, 1500);
  });
});

exportMcpBtn.addEventListener('click', () => {
  statusIndicator.className = 'processing';
  statusText.textContent = 'Exporting MCP tool...';
  chrome.runtime.sendMessage({ type: 'EXPORT_MCP', skill: generatedSkill });
});

copyMcpBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(mcpOutput.textContent).then(() => {
    copyMcpBtn.textContent = 'Copied!';
    setTimeout(() => { copyMcpBtn.textContent = 'Copy JSON'; }, 1500);
  });
});

// --- Incoming messages ---

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'NEW_EVENT') {
    totalEvents = msg.totalCount || totalEvents + 1;
    eventCount.textContent = `(${totalEvents})`;
    appendEventCard(msg.payload);
  }

  if (msg.type === 'SKILL_RESULT') {
    generatedSkill = msg.skill;
    skillOutput.textContent = msg.skill;
    outputSection.style.display = 'block';
    generateBtn.disabled = false;
    statusIndicator.className = 'done';
    statusText.textContent = 'Skill generated';
  }

  if (msg.type === 'SKILL_ERROR') {
    statusIndicator.className = '';
    statusText.textContent = `Error: ${msg.error}`;
    generateBtn.disabled = false;
  }

  if (msg.type === 'MCP_RESULT') {
    mcpOutput.textContent = JSON.stringify(msg.mcpTool, null, 2);
    mcpSection.style.display = 'block';
    statusIndicator.className = 'done';
    statusText.textContent = 'MCP tool exported';
  }

  if (msg.type === 'MCP_ERROR') {
    statusIndicator.className = '';
    statusText.textContent = `MCP export error: ${msg.error}`;
  }

  // Handle keyboard shortcut toggles
  if (msg.type === 'RECORDING_STARTED') {
    recordBtn.disabled = true;
    stopBtn.disabled = false;
    generateBtn.disabled = true;
    statusIndicator.className = 'recording';
    statusText.textContent = 'Recording...';
  }

  if (msg.type === 'RECORDING_STOPPED') {
    recordBtn.disabled = false;
    stopBtn.disabled = true;
    statusIndicator.className = '';
    statusText.textContent = `Stopped — ${totalEvents} events captured`;
    if (totalEvents > 0) generateBtn.disabled = false;
  }
});

// --- Event display ---

function appendEventCard(event) {
  const card = document.createElement('div');
  card.className = 'event-card';

  const typeBadge = document.createElement('span');
  typeBadge.className = `event-type ${event.type}`;
  typeBadge.textContent = event.type;

  const detail = document.createElement('span');
  detail.className = 'event-detail';
  detail.textContent = getEventSummary(event);

  card.appendChild(typeBadge);
  card.appendChild(detail);
  eventList.appendChild(card);

  // Auto-scroll to bottom
  eventList.scrollTop = eventList.scrollHeight;
}

function getEventSummary(event) {
  switch (event.type) {
    case 'click': {
      const el = event.element;
      if (!el) return 'unknown element';
      const label = el.aria_label || el.text || el.placeholder || el.tag;
      return `${el.tag}${el.role ? `[${el.role}]` : ''} "${truncate(label, 40)}"`;
    }
    case 'text_input': {
      const el = event.element;
      const name = el?.name || el?.aria_label || el?.placeholder || 'input';
      return `${name} = "${truncate(event.value, 40)}"`;
    }
    case 'form_submit':
      return `${event.method || 'GET'} ${truncate(event.url, 50)}`;
    case 'navigation':
      return `${event.transition_type || ''} → ${truncate(event.url, 50)}`;
    case 'key_press':
      return event.key;
    case 'text_selection':
      return `"${truncate(event.selected_text, 50)}"`;
    case 'tab_switch':
      return truncate(event.page_title || event.url || 'tab', 50);
    case 'tab_created':
      return truncate(event.url || 'new tab', 50);
    default:
      return JSON.stringify(event).substring(0, 60);
  }
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) + '…' : str;
}
