// sidepanel.js — Side panel logic for Skill Recorder
// Self-contained: exports JSON event log and ready-to-paste LLM prompts.
// Backend API is optional.

const intentInput = document.getElementById('intent');
const recordBtn = document.getElementById('record-btn');
const stopBtn = document.getElementById('stop-btn');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const eventCount = document.getElementById('event-count');
const eventList = document.getElementById('event-list');
const exportSection = document.getElementById('export-section');
const copyJsonBtn = document.getElementById('copy-json-btn');
const downloadJsonBtn = document.getElementById('download-json-btn');
const copyPromptBtn = document.getElementById('copy-prompt-btn');
const promptPreview = document.getElementById('prompt-preview');
const apiSection = document.getElementById('api-section');
const generateBtn = document.getElementById('generate-btn');
const outputSection = document.getElementById('output-section');
const skillOutput = document.getElementById('skill-output');
const copySkillBtn = document.getElementById('copy-skill-btn');
const exportMcpBtn = document.getElementById('export-mcp-btn');
const mcpSection = document.getElementById('mcp-section');
const mcpOutput = document.getElementById('mcp-output');
const copyMcpBtn = document.getElementById('copy-mcp-btn');

let totalEvents = 0;
let generatedSkill = '';
let currentIntent = '';
let currentEvents = [];

// --- Prompt templates (embedded so the extension is self-contained) ---

const PROMPT_TEMPLATE = `I recorded a browser demonstration and need you to turn it into a reusable skill document.

## My intent
{INTENT}

## Captured event log
\`\`\`json
{EVENTS}
\`\`\`

## Instructions

Please process this in three steps:

### Step 1: Context Analysis
Analyse the demonstration to extract:
- Primary goal and sub-goals
- User interests (what I focused on or searched for)
- Constraints and preferences evident from my choices
- All concrete values exactly as demonstrated (search queries, sites visited, product names, etc.)
- Notes on my approach (e.g. preferred official sources over aggregators, order of operations)

### Step 2: Action Analysis
Group the events into logical phases:
- Each phase = one meaningful sub-task (e.g. "search for reviews", "gather specifications")
- Separate corrective actions (backtracking, re-doing) from intentional procedure steps
- Identify which phases must be sequential vs could run in parallel
- Note dependencies between phases (e.g. "comparison phase depends on data from phases 1 and 2")

### Step 3: Skill Synthesis
Combine your context and action analysis into a structured SKILL.md document:

\`\`\`
---
name: <kebab-case-name>
description: "<one-sentence description>"
triggers:
  - "<trigger phrase 1>"
  - "<trigger phrase 2>"
parameters:
  - name: <param_name>
    required: true|false
    default: "<default value if any>"
    description: "<what this parameter is>"
---

# Skill: [Descriptive name]

## Purpose
[One sentence]

## When to Use
[Trigger conditions]

## Parameters
| Parameter | Description | Required | Default |
|---|---|---|---|
| ... | ... | ... | ... |

## Procedure
### Step 1: [Phase name]
**Purpose:** [What this step accomplishes]
**Requires:** [Inputs needed]
**Produces:** [Outputs generated]
[Task-level instructions — NOT click-level]

### Step 2: [Phase name]
...

## Dependencies and Execution Order
[Sequential vs parallel steps]

## Expected Outputs
[What the skill produces when complete]

## Error Handling
[What to do if a step fails]

## Notes
[Observations about approach, preferences, etc.]
\`\`\`

**Important rules:**
- Write at the TASK level, not click level. Say "Search for {product_name} specifications" NOT "Click the search box, type the query, press Enter"
- Replace concrete values with parameters where the value would change between uses
- Keep values fixed where they're part of the procedure (e.g. "use Reddit for community reviews" if that's always the approach)
- Make it reproducible by an LLM with browser access`;

// --- Recording controls ---

recordBtn.addEventListener('click', () => {
  const intent = intentInput.value.trim();
  if (!intent) {
    intentInput.focus();
    intentInput.style.borderColor = '#e53935';
    setTimeout(() => { intentInput.style.borderColor = ''; }, 1500);
    return;
  }

  currentIntent = intent;
  currentEvents = [];

  chrome.runtime.sendMessage({ type: 'START_RECORDING', intent }, () => {
    recordBtn.disabled = true;
    stopBtn.disabled = false;
    intentInput.disabled = true;
    eventList.innerHTML = '';
    totalEvents = 0;
    eventCount.textContent = '(0)';
    exportSection.style.display = 'none';
    apiSection.style.display = 'none';
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

    statusIndicator.className = '';
    statusText.textContent = `Stopped — ${totalEvents} events captured`;

    // Fetch the full event log from the background script
    chrome.runtime.sendMessage({ type: 'GET_EVENTS' }, (data) => {
      if (data && data.events && data.events.length > 0) {
        currentEvents = data.events;
        currentIntent = data.intent || currentIntent;
        showExportOptions();
      }
    });
  });
});

// --- Export options ---

function showExportOptions() {
  exportSection.style.display = 'block';
  apiSection.style.display = 'block';
  generateBtn.disabled = false;

  // Build and preview the prompt
  const prompt = buildPrompt();
  promptPreview.textContent = prompt;
}

function buildEventLog() {
  return JSON.stringify({
    intent: currentIntent,
    timestamp_start: currentEvents[0]?.timestamp || new Date().toISOString(),
    events: currentEvents
  }, null, 2);
}

function buildPrompt() {
  // Compact the events for the prompt (strip redundant fields to save tokens)
  const compactEvents = currentEvents.map(e => {
    const entry = { seq: e.seq, type: e.type };
    if (e.url) entry.url = e.url;
    if (e.page_title) entry.page_title = e.page_title;
    if (e.value) entry.value = e.value;
    if (e.selected_text) entry.selected_text = e.selected_text;
    if (e.key) entry.key = e.key;
    if (e.form_data) entry.form_data = e.form_data;
    if (e.method) entry.method = e.method;
    if (e.transition_type) entry.transition_type = e.transition_type;
    if (e.is_back_forward) entry.is_back_forward = true;
    if (e.element) {
      const el = e.element;
      entry.element = {};
      if (el.tag) entry.element.tag = el.tag;
      if (el.aria_label) entry.element.aria_label = el.aria_label;
      if (el.role) entry.element.role = el.role;
      if (el.name) entry.element.name = el.name;
      if (el.href) entry.element.href = el.href;
      if (el.placeholder) entry.element.placeholder = el.placeholder;
      if (el.label) entry.element.label = el.label;
      if (el.type) entry.element.type = el.type;
      const text = el.text || el.aria_label;
      if (text) entry.element.text = text.substring(0, 100);
    }
    return entry;
  });

  return PROMPT_TEMPLATE
    .replace('{INTENT}', currentIntent)
    .replace('{EVENTS}', JSON.stringify(compactEvents, null, 2));
}

// --- Export buttons ---

copyJsonBtn.addEventListener('click', () => {
  const json = buildEventLog();
  navigator.clipboard.writeText(json).then(() => {
    flashButton(copyJsonBtn, 'Copied!', 'Copy Event Log (JSON)');
  });
});

downloadJsonBtn.addEventListener('click', () => {
  const json = buildEventLog();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const slug = currentIntent.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 40);
  a.download = `skill-recording-${slug}.json`;
  a.click();
  URL.revokeObjectURL(url);
  flashButton(downloadJsonBtn, 'Downloaded!', 'Download JSON');
});

copyPromptBtn.addEventListener('click', () => {
  const prompt = buildPrompt();
  navigator.clipboard.writeText(prompt).then(() => {
    flashButton(copyPromptBtn, 'Copied! Paste into Claude', 'Copy Prompt for Claude');
  });
});

// --- Optional: API-powered generation ---

generateBtn.addEventListener('click', () => {
  generateBtn.disabled = true;
  statusIndicator.className = 'processing';
  statusText.textContent = 'Generating skill via API...';
  chrome.runtime.sendMessage({ type: 'GENERATE_SKILL' });
});

// --- Skill output buttons ---

copySkillBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(generatedSkill).then(() => {
    flashButton(copySkillBtn, 'Copied!', 'Copy SKILL.md');
  });
});

exportMcpBtn.addEventListener('click', () => {
  statusIndicator.className = 'processing';
  statusText.textContent = 'Exporting MCP tool...';
  chrome.runtime.sendMessage({ type: 'EXPORT_MCP', skill: generatedSkill });
});

copyMcpBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(mcpOutput.textContent).then(() => {
    flashButton(copyMcpBtn, 'Copied!', 'Copy JSON');
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

  if (msg.type === 'RECORDING_STARTED') {
    recordBtn.disabled = true;
    stopBtn.disabled = false;
    statusIndicator.className = 'recording';
    statusText.textContent = 'Recording...';
  }

  if (msg.type === 'RECORDING_STOPPED') {
    recordBtn.disabled = false;
    stopBtn.disabled = true;
    statusIndicator.className = '';
    statusText.textContent = `Stopped — ${totalEvents} events captured`;
    // Fetch events for export
    chrome.runtime.sendMessage({ type: 'GET_EVENTS' }, (data) => {
      if (data && data.events && data.events.length > 0) {
        currentEvents = data.events;
        currentIntent = data.intent || currentIntent;
        showExportOptions();
      }
    });
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

function flashButton(btn, tempText, originalText) {
  btn.textContent = tempText;
  setTimeout(() => { btn.textContent = originalText; }, 2000);
}
