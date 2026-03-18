# Skill Recorder: Browser Demonstration → Reusable Skill Generation

## What This Is

A prototype tool that watches a user perform a task in a browser, captures DOM-level events, and uses an LLM pipeline to generate a structured, reusable skill file. The user declares intent ("I'm going to show you how to do X"), performs the task, and the system outputs a SKILL.md or MCP tool definition.

Based on the architecture described in the Alloy paper (Li et al., 2025, arxiv 2510.10049) with adaptations for practical skill-file output rather than DAG-based workflow execution.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Chrome Extension                          │
│                                                              │
│  ┌──────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │  Intent   │    │   Event      │    │   Side Panel     │   │
│  │  Capture  │───▶│   Recorder   │───▶│   (live preview) │   │
│  │  (voice/  │    │   (CDP +     │    │                  │   │
│  │   text)   │    │    DOM API)  │    └──────────────────┘   │
│  └──────────┘    └──────┬───────┘                            │
│                         │                                    │
└─────────────────────────┼────────────────────────────────────┘
                          │ Event log + metadata
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  LLM Processing Pipeline                     │
│                                                              │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────────┐   │
│  │ Agent 1:  │    │ Agent 2:  │    │ Agent 3:             │   │
│  │ Context   │───▶│ Action    │───▶│ Skill Synthesiser    │   │
│  │ Analyser  │    │ Analyser  │    │                      │   │
│  └──────────┘    └──────────┘    └──────────┬────────────┘   │
│                                              │               │
│  ┌──────────────────────────────────────┐    │               │
│  │ Agent 4: Generaliser (optional)      │◀───┘               │
│  │ (makes skill reusable with params)   │                    │
│  └──────────────────┬───────────────────┘                    │
│                     │                                        │
└─────────────────────┼────────────────────────────────────────┘
                      │
                      ▼
              ┌───────────────┐
              │  Output:       │
              │  SKILL.md  or  │
              │  MCP tool def  │
              └───────────────┘
```

## Component 1: Event Recorder (Chrome Extension)

### What to capture

Use standard DOM APIs available in all browsers. For each user action, record:

| Event Type | What to Log | DOM Context |
|---|---|---|
| Click | Target element, text content, coordinates | Tag, class, id, aria-label, role, href |
| Text input | Final value (debounced, not keystrokes) | Input name, placeholder, label, form id |
| Form submission | All form field values | Form action URL, method |
| Navigation | URL changes, page title | Referrer, trigger (click vs address bar) |
| Text selection | Selected text content | Parent element context |
| Scroll (significant) | Direction, approximate viewport position | Page section reached |

### Filtering rules (reduce noise)

- Ignore clicks on generic layout elements (divs with no semantic content, background containers)
- Debounce text input — only capture final value after pause (500ms)
- Ignore duplicate navigations (e.g. same URL reload)
- Skip hover events unless they trigger visible state changes
- Flag but don't discard "back" navigation and corrections — the LLM needs to see these to distinguish mistakes from intentional steps

### Event log format

```json
{
  "intent": "Show how to compare phone specifications across brands",
  "timestamp_start": "2026-03-17T10:00:00Z",
  "events": [
    {
      "seq": 1,
      "timestamp": "2026-03-17T10:00:05Z",
      "type": "navigation",
      "url": "https://www.google.com",
      "trigger": "address_bar",
      "page_title": "Google"
    },
    {
      "seq": 2,
      "timestamp": "2026-03-17T10:00:08Z",
      "type": "text_input",
      "value": "iPhone 17 Pro specifications",
      "element": {
        "tag": "input",
        "name": "q",
        "aria_label": "Search",
        "form_id": null
      }
    },
    {
      "seq": 3,
      "timestamp": "2026-03-17T10:00:09Z",
      "type": "form_submit",
      "url": "https://www.google.com/search?q=iPhone+17+Pro+specifications"
    },
    {
      "seq": 4,
      "timestamp": "2026-03-17T10:00:14Z",
      "type": "click",
      "element": {
        "tag": "a",
        "text": "iPhone 17 Pro - Technical Specifications - Apple",
        "href": "https://www.apple.com/iphone-17-pro/specs/",
        "class": "result-link"
      }
    }
  ]
}
```

### Implementation Guide

The event recorder is a Chrome Extension (Manifest V3) with three layers that capture
complementary signals. Reference implementations to study:

- **DeploySentinel Recorder** (github.com/DeploySentinel/Recorder) — open source Chrome
  extension that captures clicks, keyboard inputs, scroll events and generates element
  selectors using id, class, aria-label, alt, name, data-testid. Outputs Playwright/
  Puppeteer scripts. Best starting point for the content script code.
- **Chrome DevTools Recorder** (built into Chrome) — records user flows with robust dual
  selectors (ARIA + CSS) and exports as Puppeteer scripts. Study its selector generation
  strategy and its recording format.
- **DOMListenerExtension** (github.com/kdzwinel/DOMListenerExtension) — uses
  MutationObserver to watch DOM changes (node add/remove, attribute changes, text
  modifications). Useful reference for the state change layer.
- **Alloy paper** (arxiv 2510.10049) — describes the filtering approach: uses standard
  DOM APIs (elementFromPoint, event.target, FormData), skips low-information elements,
  debounces transient input, records only finalised interactions with minimal metadata.

#### Layer 1: Content Script — User Actions

This is the primary recording layer. A content script injected into every page captures
user-initiated events. This is what Alloy and DeploySentinel both use.

```javascript
// content-script.js — injected into all pages during recording

const DEBOUNCE_MS = 500;
let inputTimers = new Map();
let events = [];
let recording = false;

// Listen for record toggle from extension
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'toggle_recording') {
    recording = msg.recording;
    if (recording) events = [];
  }
});

// ---- Element metadata extraction ----
// Key design decision: capture SEMANTIC identifiers, not positional ones.
// Priority order for selectors (from DeploySentinel/Chrome Recorder approach):
//   1. aria-label / role (accessibility — most stable)
//   2. id (if not auto-generated — skip ids like "ember123" or "react-xyz")
//   3. name attribute (especially for form inputs)
//   4. data-testid / data-cy (test attributes — very stable)
//   5. placeholder text / label association
//   6. text content (for links/buttons — what the user sees)
//   7. tag + class as fallback

function getElementMeta(el) {
  if (!el || !el.tagName) return null;

  // Find associated label for form inputs
  let label = null;
  if (el.id) {
    const labelEl = document.querySelector(`label[for="${el.id}"]`);
    if (labelEl) label = labelEl.textContent.trim();
  }
  if (!label && el.closest('label')) {
    label = el.closest('label').textContent.trim();
  }

  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    name: el.getAttribute('name') || null,
    class: el.className || null,
    role: el.getAttribute('role') || null,
    aria_label: el.getAttribute('aria-label') || null,
    data_testid: el.getAttribute('data-testid') || null,
    placeholder: el.getAttribute('placeholder') || null,
    label: label,
    href: el.getAttribute('href') || null,
    type: el.getAttribute('type') || null,
    text: el.textContent?.trim().substring(0, 200) || null, // truncate long text
    value: el.value || null,
    // For filtering: is this a meaningful interactive element?
    is_interactive: isInteractive(el)
  };
}

function isInteractive(el) {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  const interactiveTags = ['a', 'button', 'input', 'select', 'textarea', 'details', 'summary'];
  const interactiveRoles = ['button', 'link', 'menuitem', 'tab', 'checkbox', 'radio',
                            'textbox', 'combobox', 'searchbox', 'option'];
  return interactiveTags.includes(tag)
    || interactiveRoles.includes(role)
    || el.getAttribute('onclick') !== null
    || el.getAttribute('tabindex') !== null;
}

// ---- Filtering (from Alloy paper approach) ----
// Skip clicks on non-interactive containers, layout divs, body, html
function shouldSkipClick(el) {
  const tag = el.tagName.toLowerCase();
  if (['html', 'body'].includes(tag)) return true;

  // Walk up to find nearest interactive ancestor (max 3 levels)
  // If user clicked a <span> inside a <button>, we want the <button>
  let current = el;
  for (let i = 0; i < 3; i++) {
    if (isInteractive(current)) return false;
    if (!current.parentElement) break;
    current = current.parentElement;
  }

  // No interactive element found — likely a background/layout click
  return true;
}

// Find the best target: bubble up to nearest interactive ancestor
function findBestTarget(el) {
  let current = el;
  for (let i = 0; i < 3; i++) {
    if (isInteractive(current)) return current;
    if (!current.parentElement) break;
    current = current.parentElement;
  }
  return el; // fallback to original
}

// ---- Event handlers ----

document.addEventListener('click', (e) => {
  if (!recording) return;
  if (shouldSkipClick(e.target)) return;

  const target = findBestTarget(e.target);
  pushEvent({
    type: 'click',
    element: getElementMeta(target),
    coordinates: { x: e.clientX, y: e.clientY }
  });
}, true); // capture phase to get events before handlers cancel them

// Debounced text input — only record final value
document.addEventListener('input', (e) => {
  if (!recording) return;
  const el = e.target;
  if (!['INPUT', 'TEXTAREA'].includes(el.tagName)) return;

  const key = el.name || el.id || el.getAttribute('aria-label') || 'unknown';

  // Clear previous timer for this input
  if (inputTimers.has(key)) clearTimeout(inputTimers.get(key));

  // Set new timer — only fires after user stops typing
  inputTimers.set(key, setTimeout(() => {
    pushEvent({
      type: 'text_input',
      value: el.value,
      element: getElementMeta(el)
    });
    inputTimers.delete(key);
  }, DEBOUNCE_MS));
}, true);

// Form submissions — capture complete form data
document.addEventListener('submit', (e) => {
  if (!recording) return;
  const form = e.target;
  const formData = {};
  try {
    const fd = new FormData(form);
    for (const [key, value] of fd.entries()) {
      formData[key] = value;
    }
  } catch (err) { /* FormData may fail on some forms */ }

  pushEvent({
    type: 'form_submit',
    url: form.action || window.location.href,
    method: form.method || 'GET',
    form_data: formData,
    element: getElementMeta(form)
  });
}, true);

// Text selection — useful for "user read this" signals
document.addEventListener('mouseup', (e) => {
  if (!recording) return;
  const selection = window.getSelection();
  const text = selection?.toString().trim();
  if (text && text.length > 5) { // ignore accidental micro-selections
    pushEvent({
      type: 'text_selection',
      selected_text: text.substring(0, 500),
      parent_element: getElementMeta(selection.anchorNode?.parentElement)
    });
  }
});

// Keyboard shortcuts (Enter to submit, Tab navigation, Escape)
document.addEventListener('keydown', (e) => {
  if (!recording) return;
  if (['Enter', 'Escape', 'Tab'].includes(e.key)) {
    pushEvent({
      type: 'key_press',
      key: e.key,
      element: getElementMeta(e.target)
    });
  }
});

function pushEvent(event) {
  event.seq = events.length + 1;
  event.timestamp = new Date().toISOString();
  event.url = window.location.href;
  event.page_title = document.title;
  events.push(event);

  // Send to background script for aggregation
  chrome.runtime.sendMessage({
    type: 'event_recorded',
    event: event
  });
}
```

#### Layer 2: Background Script — Navigation & Tab Events

The background script (service worker in MV3) captures page-level events that content
scripts can't see: navigation, tab switches, page loads.

```javascript
// background.js — service worker

let allEvents = [];
let recording = false;
let currentIntent = '';

// Toggle recording from side panel
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'start_recording') {
    recording = true;
    currentIntent = msg.intent;
    allEvents = [];

    // Notify all tabs to start recording
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'toggle_recording', recording: true
        }).catch(() => {}); // ignore tabs where content script isn't injected
      });
    });
  }

  if (msg.type === 'stop_recording') {
    recording = false;
    // Notify all tabs to stop
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'toggle_recording', recording: false
        }).catch(() => {});
      });
    });
    sendResponse({ intent: currentIntent, events: allEvents });
  }

  // Aggregate events from content scripts
  if (msg.type === 'event_recorded' && recording) {
    allEvents.push(msg.event);
    // Forward to side panel for live display
    chrome.runtime.sendMessage({
      type: 'event_for_display',
      event: msg.event,
      total_count: allEvents.length
    }).catch(() => {});
  }
});

// ---- Navigation events (cleaner than detecting from content script) ----

// chrome.webNavigation fires for all navigation types
chrome.webNavigation.onCompleted.addListener((details) => {
  if (!recording) return;
  if (details.frameId !== 0) return; // only main frame

  allEvents.push({
    seq: allEvents.length + 1,
    timestamp: new Date().toISOString(),
    type: 'navigation_complete',
    url: details.url,
    tab_id: details.tabId,
    trigger: 'page_load'
  });
});

// Detect back/forward navigation
chrome.webNavigation.onCommitted.addListener((details) => {
  if (!recording) return;
  if (details.frameId !== 0) return;

  // transitionType tells us HOW the navigation happened
  // 'link' = user clicked a link
  // 'typed' = user typed in address bar
  // 'auto_bookmark' = bookmark click
  // 'form_submit' = form submission
  // 'reload' = page reload
  // 'keyword' = omnibox keyword
  const backForward = details.transitionQualifiers?.includes('forward_back');

  allEvents.push({
    seq: allEvents.length + 1,
    timestamp: new Date().toISOString(),
    type: 'navigation_commit',
    url: details.url,
    tab_id: details.tabId,
    transition_type: details.transitionType,
    is_back_forward: backForward || false
  });
});

// Tab switches — signals context changes
chrome.tabs.onActivated.addListener((activeInfo) => {
  if (!recording) return;
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    allEvents.push({
      seq: allEvents.length + 1,
      timestamp: new Date().toISOString(),
      type: 'tab_switch',
      tab_id: activeInfo.tabId,
      url: tab?.url,
      page_title: tab?.title
    });
  });
});

// New tab creation
chrome.tabs.onCreated.addListener((tab) => {
  if (!recording) return;
  allEvents.push({
    seq: allEvents.length + 1,
    timestamp: new Date().toISOString(),
    type: 'tab_created',
    tab_id: tab.id,
    url: tab.pendingUrl || tab.url
  });

  // Inject content script into new tab
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content-script.js']
  }).catch(() => {});
});
```

#### Layer 3: MutationObserver — Page State Changes (Optional but Valuable)

This layer watches for DOM changes that happen AS A RESULT of user actions. It answers
"what happened after I clicked that button?" — e.g. a modal appeared, new content loaded,
an error message showed up. This gives the LLM critical context about cause and effect.

Based on the DOMListenerExtension approach but filtered to only capture significant changes.

```javascript
// Add to content-script.js

let observer = null;
const MUTATION_DEBOUNCE_MS = 300;
let mutationBuffer = [];
let mutationTimer = null;

function startObserving() {
  observer = new MutationObserver((mutations) => {
    if (!recording) return;

    for (const mutation of mutations) {
      // Only care about significant structural changes
      if (mutation.type === 'childList') {
        // New nodes added — might be new content, modal, error message
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (isLayoutNoise(node)) continue;

          mutationBuffer.push({
            mutation_type: 'node_added',
            tag: node.tagName?.toLowerCase(),
            text_preview: node.textContent?.trim().substring(0, 200),
            class: node.className || null,
            role: node.getAttribute?.('role') || null,
            aria_label: node.getAttribute?.('aria-label') || null,
            is_visible: isVisible(node),
            child_count: node.querySelectorAll?.('*').length || 0
          });
        }

        // Nodes removed — content disappeared, modal closed
        for (const node of mutation.removedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (isLayoutNoise(node)) continue;

          mutationBuffer.push({
            mutation_type: 'node_removed',
            tag: node.tagName?.toLowerCase(),
            text_preview: node.textContent?.trim().substring(0, 100),
          });
        }
      }

      // Attribute changes on significant elements (e.g. class toggling to show/hide)
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        const el = mutation.target;
        if (isInteractive(el) || el.getAttribute('role')) {
          mutationBuffer.push({
            mutation_type: 'attribute_changed',
            tag: el.tagName?.toLowerCase(),
            attribute: mutation.attributeName,
            old_value: mutation.oldValue,
            new_value: el.getAttribute(mutation.attributeName),
          });
        }
      }
    }

    // Debounce: batch mutations into single event
    if (mutationTimer) clearTimeout(mutationTimer);
    mutationTimer = setTimeout(flushMutations, MUTATION_DEBOUNCE_MS);
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'disabled']
  });
}

function flushMutations() {
  if (mutationBuffer.length === 0) return;

  // Summarise: don't send 50 individual mutations, send a digest
  const added = mutationBuffer.filter(m => m.mutation_type === 'node_added');
  const removed = mutationBuffer.filter(m => m.mutation_type === 'node_removed');
  const changed = mutationBuffer.filter(m => m.mutation_type === 'attribute_changed');

  // Only push if something meaningful happened
  const significantAdded = added.filter(m => m.is_visible && m.child_count > 0);
  if (significantAdded.length > 0 || removed.length > 0) {
    pushEvent({
      type: 'page_state_change',
      summary: {
        nodes_added: significantAdded.length,
        nodes_removed: removed.length,
        attributes_changed: changed.length,
        // Include the most significant new content
        new_content_preview: significantAdded
          .sort((a, b) => b.child_count - a.child_count)
          .slice(0, 3)
          .map(m => ({
            tag: m.tag,
            text: m.text_preview,
            role: m.role
          }))
      }
    });
  }

  mutationBuffer = [];
}

function isLayoutNoise(node) {
  if (!node.tagName) return true;
  const tag = node.tagName.toLowerCase();
  // Skip script/style/svg/noscript/iframe injections
  if (['script', 'style', 'svg', 'noscript', 'link', 'meta'].includes(tag)) return true;
  // Skip elements with no visible content
  if (!node.textContent?.trim() && !node.querySelector?.('img, video, canvas')) return true;
  return false;
}

function isVisible(node) {
  if (!node.getBoundingClientRect) return false;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
```

#### Extension Manifest

```json
{
  "manifest_version": 3,
  "name": "Skill Recorder",
  "version": "0.1.0",
  "description": "Record browser demonstrations and generate reusable LLM skills",
  "permissions": [
    "storage",
    "tabs",
    "activeTab",
    "scripting",
    "webNavigation",
    "sidePanel"
  ],
  "host_permissions": ["<all_urls>"],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content-script.js"],
      "run_at": "document_idle"
    }
  ],
  "side_panel": {
    "default_path": "sidepanel.html"
  },
  "action": {
    "default_title": "Skill Recorder"
  },
  "commands": {
    "toggle-recording": {
      "suggested_key": { "default": "Ctrl+Shift+R" },
      "description": "Start/stop recording"
    }
  }
}
```

#### Side Panel UI (minimal)

The side panel provides: intent input, record/stop button, live event feed, and
the generated skill output after processing.

```html
<!-- sidepanel.html -->
<!DOCTYPE html>
<html>
<head><title>Skill Recorder</title></head>
<body>
  <div id="intent-section">
    <label>What are you going to demonstrate?</label>
    <input type="text" id="intent" placeholder="e.g. How to compare phone specs across brands">
  </div>

  <button id="record-btn">Start Recording</button>
  <button id="stop-btn" disabled>Stop & Generate Skill</button>

  <div id="event-feed">
    <h3>Events captured: <span id="event-count">0</span></h3>
    <ul id="event-list"></ul>
  </div>

  <div id="output-section" style="display:none">
    <h3>Generated Skill</h3>
    <pre id="skill-output"></pre>
    <button id="copy-btn">Copy SKILL.md</button>
    <button id="export-mcp-btn">Export as MCP Tool</button>
  </div>

  <script src="sidepanel.js"></script>
</body>
</html>
```

#### Key Design Decisions for the Recorder

**Selector strategy matters.** The Chrome DevTools Recorder generates multiple selectors
per element (ARIA first, then CSS fallback) because no single selector type is reliable
across all sites. For skill generation the ARIA/semantic selectors are more useful than
CSS selectors because they describe WHAT an element is rather than WHERE it is. The LLM
needs to know "this is a Search input" not "this is div.header > form > input:nth-child(2)".

**Bubble up to interactive ancestor.** When a user clicks a `<span>` inside a `<button>`,
you want the `<button>`, not the `<span>`. The `findBestTarget` function walks up the DOM
to find the nearest meaningful interactive element. This is critical for producing
clean event logs — without it you get dozens of clicks on random `<span>` and `<div>`
elements that mean nothing to the LLM.

**Debounce everything.** Text input should be debounced (capture final value, not
keystrokes). Mutations should be debounced (batch into digests, not individual node
additions). Scroll should be heavily debounced (capture only significant position
changes, not continuous scroll events). The goal is to produce an event log of ~20-100
events for a typical 5-minute demonstration, not thousands.

**Navigation via webNavigation API, not content script.** The chrome.webNavigation API
is more reliable and provides transition type metadata (typed, link, form_submit,
back_forward) that tells the LLM HOW the user navigated, not just WHERE. This is
essential for distinguishing intentional navigation from corrections.

**MutationObserver is optional but valuable.** Layer 3 adds complexity but gives the
LLM cause-and-effect understanding: "user clicked Search → results appeared → user
clicked first result." Without it the LLM has to infer what happened between clicks,
which it can do from URLs but not always reliably. Start without it in v0.1, add it
in v0.2 when the basic pipeline works.

**Store nothing permanently.** Events stay in memory during recording and are sent to
the LLM pipeline on stop. No persistent storage of user browsing data. This is both
a privacy feature and simplifies the implementation.

## Component 2: LLM Processing Pipeline

Three agents run sequentially on the captured event log. The output of agents 1 and 2 feeds into agent 3.

### Agent 1: Context Analyser

**Purpose:** Extract the user's goals, interests, constraints, and preferences from the demonstration metadata. Preserve all concrete values exactly as demonstrated.

**System prompt:**

```
You are a Context Analysis Agent. Your task is to analyse a user's browser
demonstration and extract their goals, interests, and constraints.

You will receive:
1. The user's declared intent (what they said they would demonstrate)
2. A log of browser events with DOM metadata

Analyse the demonstration and return a JSON object with:

{
  "primary_goal": "The main task the user is trying to accomplish",
  "sub_goals": ["List of subsidiary goals identified from the demonstration"],
  "user_interests": ["Specific things the user focused on or searched for"],
  "constraints": ["Any constraints or preferences evident from their choices"],
  "concrete_values": {
    "Key entities and specific values used in the demonstration, e.g.":
    "product_name": "iPhone 17 Pro",
    "sites_visited": ["apple.com", "reddit.com"],
    "search_queries": ["iPhone 17 Pro specifications", "iPhone 17 Pro reviews Reddit"]
  },
  "context_notes": "Any additional observations about the user's approach, such as
                     whether they compared multiple sources, preferred official sites
                     over aggregators, etc."
}

Rules:
- Preserve ALL concrete values exactly as demonstrated — do not generalise at this stage
- Distinguish between the user's actual goals and incidental actions (e.g. closing a popup)
- Note the ORDER in which the user pursued sub-goals, as this may reflect priority
- If the user backtracked or corrected themselves, note what they corrected and why
```

**Input:** `{ intent, events }` from the event recorder

### Agent 2: Action Analyser

**Purpose:** Process the interaction log to identify high-level action sequences, group related events into logical phases, and distinguish intentional steps from noise/corrections.

**System prompt:**

```
You are an Action Analysis Agent. Your task is to process a browser event log
and identify the high-level action sequences that constitute the user's procedure.

You will receive:
1. The user's declared intent
2. A log of browser events with DOM metadata

Group the events into logical action phases and return a JSON object:

{
  "phases": [
    {
      "phase_id": 1,
      "name": "Short descriptive name for this phase",
      "description": "What the user accomplished in this phase",
      "events": [1, 2, 3, 4],
      "key_actions": [
        "Searched Google for product specifications",
        "Navigated to official product page",
        "Reviewed specifications section"
      ],
      "inputs": ["What information or state this phase requires"],
      "outputs": ["What information or state this phase produces"],
      "is_corrective": false
    }
  ],
  "noise_events": [
    {
      "event_seq": 7,
      "reason": "User clicked back button — this was a correction, not a procedural step"
    }
  ],
  "dependencies": [
    {
      "phase": 3,
      "depends_on": [1, 2],
      "reason": "Phase 3 compares data gathered in phases 1 and 2"
    }
  ],
  "parallelisable": [
    {
      "phases": [2, 3],
      "reason": "These phases gather independent information and could run simultaneously"
    }
  ]
}

Rules:
- Group events by SEMANTIC purpose, not just by time proximity
- A phase should represent one meaningful sub-task (e.g. "search for reviews")
- Separate corrective actions (backtracking, re-doing) from intentional procedure
- Identify which phases MUST be sequential vs which could run in parallel
- Each phase should have clear inputs and outputs
- Reconstruct completed form inputs from individual keystroke/change events
```

**Input:** `{ intent, events }` from the event recorder

### Agent 3: Skill Synthesiser

**Purpose:** Combine context analysis and action analysis into a structured skill document that an LLM can follow to reproduce the demonstrated procedure.

**System prompt:**

```
You are a Skill Synthesis Agent. Your task is to combine a context analysis and
an action analysis of a user's browser demonstration into a structured, reusable
skill document.

You will receive:
1. The user's declared intent
2. A context analysis (goals, interests, constraints, concrete values)
3. An action analysis (phases, dependencies, parallelisation opportunities)

Generate a skill document in the following markdown format:

---

# Skill: [Descriptive name derived from the intent]

## Purpose
[One-sentence description of what this skill accomplishes]

## When to Use
[Conditions under which this skill should be triggered]

## Parameters
[List of inputs the skill needs, derived from concrete values in the demonstration.
 Mark which are required vs optional. Include defaults where the demonstration
 provides them.]

| Parameter | Description | Required | Default |
|---|---|---|---|
| ... | ... | ... | ... |

## Procedure

### Step 1: [Phase name]
**Purpose:** [What this step accomplishes]
**Requires:** [Inputs needed]
**Produces:** [Outputs generated]

[Detailed natural language instructions for executing this step, written at
 the right level of abstraction — not "click the blue button" but
 "search for {product_name} specifications on the manufacturer's website"]

### Step 2: [Phase name]
...

## Dependencies and Execution Order
[Which steps must be sequential, which can be parallel]

## Expected Outputs
[What the skill should produce when complete]

## Error Handling
[What to do if a step fails — e.g. if a site is unavailable, try alternative]

## Notes
[Any observations about the user's approach that might be relevant for
 future execution — e.g. "the user preferred official sources over aggregators"]

---

Rules:
- Write instructions at the TASK level, not the click level
  WRONG: "Click the search box, type 'iPhone 17 Pro', press Enter"
  RIGHT: "Search for {product_name} specifications using a search engine"
- Replace concrete values with parameters where the value would change between uses
- Keep concrete values where they represent a FIXED part of the procedure
  (e.g. "navigate to Reddit" is fixed if the procedure always uses Reddit)
- Include the user's procedural preferences (e.g. order of operations, preferred sources)
- Make the procedure reproducible by an LLM with browser access
- Include enough context that the skill could be understood without seeing the demonstration
```

**Input:** `{ intent, context_analysis, action_analysis }`

### Agent 4: Generaliser (Optional)

**Purpose:** When the user wants to adapt the skill for a different but structurally similar task, identify which values are task-specific and replace them with parameters.

This is a two-step process:

#### Step 4a: Identifier / Semanticiser

```
You are a Workflow Identifier Agent. Your task is to analyse an existing skill
document and identify all task-specific values that should become parameters
for the skill to be reusable.

You will receive:
1. An existing skill document
2. A natural language instruction describing how to adapt it

For each task-specific value, create a semantic placeholder:

{
  "placeholders": [
    {
      "original_value": "iPhone 17 Pro",
      "placeholder": "{product_name}",
      "semantic_description": "The name of the product to research",
      "location": "Found in Steps 1, 2, and 3"
    },
    {
      "original_value": "apple.com",
      "placeholder": "{manufacturer_site}",
      "semantic_description": "The official website of the product manufacturer",
      "location": "Found in Step 2"
    }
  ]
}

Rules:
- Only parameterise values that WOULD change between uses
- Keep structural elements fixed (e.g. "use a search engine" stays fixed)
- Preserve the workflow structure — only values change, not steps
- Document each placeholder with enough description that a filling agent
  can provide appropriate values
```

#### Step 4b: Filler / Generaliser

```
You are a Workflow Filler Agent. Your task is to take a parameterised skill
document and fill in the placeholders according to the user's new requirements.

You will receive:
1. A parameterised skill document with {placeholder} values
2. A list of placeholders with their semantic descriptions
3. The user's natural language instruction for the new task

For each placeholder, provide a concrete value that satisfies:
- The semantic description of the placeholder
- The user's stated requirements
- Any constraints from the original skill

Return:
{
  "filled_values": {
    "{product_name}": "Samsung Galaxy S25 Ultra",
    "{manufacturer_site}": "samsung.com"
  },
  "adaptation_notes": "Any structural changes needed beyond value replacement"
}

Rules:
- Infer values from the user's instruction and general knowledge
- If a value cannot be determined from the instruction, flag it as needing user input
- If the new task requires structural changes (e.g. additional steps), note them
  in adaptation_notes
```

## Component 3: Output Formats

### Option A: SKILL.md (for Claude Code / Claude Projects)

The direct output of Agent 3. A markdown file with frontmatter that Claude can use as instructions.

```yaml
---
name: product-research
description: "Research and compare product specifications, pricing, and reviews
  across brands using official manufacturer sites and community forums"
triggers:
  - "compare products"
  - "research specifications"
  - "product comparison"
parameters:
  - name: product_name
    required: true
    description: "The product to research (e.g. 'iPhone 17 Pro')"
  - name: additional_sources
    required: false
    default: "Reddit"
    description: "Community source for reviews"
---
```

### Option B: MCP Tool Definition (for MCP-based distribution)

Convert the skill into an MCP tool with typed parameters:

```json
{
  "name": "research_product",
  "description": "Research and compare product specifications, pricing, and reviews",
  "inputSchema": {
    "type": "object",
    "properties": {
      "product_name": {
        "type": "string",
        "description": "The product to research"
      },
      "additional_sources": {
        "type": "array",
        "items": { "type": "string" },
        "default": ["Reddit"],
        "description": "Community sources for reviews"
      }
    },
    "required": ["product_name"]
  }
}
```

## Implementation Plan for Prototype

### Phase 1: Minimal event recorder (Chrome Extension)

Build the extension using the code templates in Component 1 above.

1. Start with just the content script (Layer 1) and background script (Layer 2)
2. Side panel with intent text input and Record/Stop buttons
3. Content script captures click, text_input, form_submit events only
4. Background script captures navigation via chrome.webNavigation
5. On stop, dump the aggregated event log as JSON to console / clipboard
6. Test on 2-3 simple workflows (e.g. Google search, fill a form, compare two products)

Skip MutationObserver (Layer 3) in this phase. Skip scroll events. Keep it simple.

Study the DeploySentinel Recorder source (github.com/DeploySentinel/Recorder) for
patterns around selector generation and event capture. Don't fork it — it's oriented
towards test script generation, not skill generation — but borrow the content script
patterns.

**Tech:** Chrome Extension Manifest V3, content script, side panel API, chrome.webNavigation

**Deliverable:** An extension that produces a clean JSON event log from a browser demonstration

### Phase 2: Local processing backend

Build a server that receives the event log and runs the three-agent pipeline:

1. POST endpoint that accepts `{ intent, events }` JSON
2. Runs Agent 1 (Context Analyser) and Agent 2 (Action Analyser) in parallel
3. Feeds both outputs into Agent 3 (Skill Synthesiser)
4. Returns the generated SKILL.md as response
5. Simple HTML page to view the generated skill

Use the Anthropic SDK. Each agent is a single API call with the system prompt from
Component 2 and the event data as user message. No complex orchestration needed.

**Tech:** Node.js + Express (or Python + FastAPI), Anthropic SDK

**Deliverable:** A server that turns event logs into SKILL.md files

### Phase 3: End-to-end integration + review loop

Wire the extension to the backend:

1. Side panel sends event log to backend on Stop
2. Backend returns generated skill
3. Side panel displays the skill for review
4. User can annotate: "this bit was a mistake", "this step is optional"
5. Annotations get sent back to Agent 3 as corrections for re-synthesis
6. Export buttons: Copy SKILL.md, Download as .md, Export as MCP tool JSON

Add MutationObserver (Layer 3) in this phase if the LLM is struggling to understand
cause-and-effect relationships from actions alone.

**Deliverable:** A working record → review → export pipeline

### Phase 4: Generalisation + skill library

Add the two-agent generalisation pipeline (Agent 4a + 4b):

1. User can load a previously generated skill
2. Types adaptation instruction ("now do this for Samsung instead of Apple")
3. System runs Identifier → Filler pipeline
4. Outputs adapted skill
5. Local skill library (JSON file or SQLite) to store and browse generated skills

**Deliverable:** Reusable, parameterised skills that can be adapted via natural language

## Key Design Decisions

**Task-level abstraction, not click-level.** The most important design choice. The skill should say "search for the product on the manufacturer's website" not "click the search box, type the query, press enter." This is what makes skills transferable across interface changes.

**Declaration of intent upfront.** The user saying "I'm going to show you how to do X" provides the framing that lets the LLM distinguish signal from noise in the event stream.

**Semantic selectors over positional ones.** When recording element metadata, prioritise aria-label, role, name, and text content over CSS classes and DOM position. The LLM needs to know WHAT an element is, not WHERE it is in the DOM tree.

**Bubble up to interactive ancestors.** When capturing clicks, walk up the DOM to find the nearest button/link/input rather than recording clicks on inner spans and divs. This dramatically cleans up the event log.

**Debounce aggressively.** Target 20-100 events for a typical 5-minute demonstration. More than that and the LLM prompt gets too long and noisy. Text input → final value only. Mutations → batched digests. Scroll → skip entirely in v0.1.

**Human-in-the-loop review.** The LLM's first interpretation won't be perfect. The review step is where the user corrects misunderstandings before the skill is stored.

**Separate context and action analysis.** Running these in parallel (as Alloy does) gives the synthesiser two complementary views: WHY the user did things (context) and WHAT they did (actions).

**Generalisation is optional and separate.** Not every skill needs to be parameterised. Some are specific procedures that should stay concrete.

**Store nothing permanently in the extension.** Events live in memory during recording and are sent to the backend on stop. No persistent storage of browsing data. Privacy by default.

## References

- Li, J., Ning, Z., Tian, Y., & Li, T. J. (2025). Alloy: Generating Reusable Agent Workflows from User Demonstration. arXiv:2510.10049
- DeploySentinel Recorder (github.com/DeploySentinel/Recorder) — open source Chrome extension for recording browser actions, outputs Playwright/Puppeteer. Best reference for content script patterns.
- DOMListenerExtension (github.com/kdzwinel/DOMListenerExtension) — MutationObserver-based DOM change monitoring. Reference for Layer 3.
- Chrome DevTools Recorder (developer.chrome.com/docs/devtools/recorder) — built-in Chrome recording with ARIA + CSS dual selectors. Reference for selector strategy.
- Skyvern (github.com/Skyvern-AI/skyvern) — browser automation with LLMs, has "Action Recorder" on roadmap
- AgentTrek (agenttrek.github.io) — trajectory synthesis from web tutorials
- Browser Use (github.com/browser-use/browser-use) — LLM-driven browser automation framework
