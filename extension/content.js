// content.js — Content script injected into all pages during recording
// Captures user actions: clicks, text input, form submissions, text selection, key presses

const DEBOUNCE_MS = 500;
const inputTimers = new Map();
let events = [];
let recording = false;
let seqCounter = 0;

// --- Recording state control ---

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'START_RECORDING') {
    recording = true;
    events = [];
    seqCounter = 0;
  }
  if (msg.type === 'STOP_RECORDING') {
    recording = false;
    // Flush any pending input timers
    for (const [key, timer] of inputTimers) {
      clearTimeout(timer);
    }
    inputTimers.clear();
  }
});

// --- Element metadata extraction ---
// Priority: aria-label → role → id → data-testid → name → placeholder → text → tag+class

function getElementMeta(el) {
  if (!el || !el.tagName) return null;

  // Find associated label for form inputs
  let label = null;
  if (el.id) {
    const labelEl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (labelEl) label = labelEl.textContent.trim();
  }
  if (!label && el.closest('label')) {
    label = el.closest('label').textContent.trim();
  }

  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    name: el.getAttribute('name') || null,
    class: el.className && typeof el.className === 'string' ? el.className : null,
    role: el.getAttribute('role') || null,
    aria_label: el.getAttribute('aria-label') || null,
    data_testid: el.getAttribute('data-testid') || null,
    placeholder: el.getAttribute('placeholder') || null,
    label: label,
    href: el.getAttribute('href') || null,
    type: el.getAttribute('type') || null,
    text: el.textContent?.trim().substring(0, 200) || null,
    is_interactive: isInteractive(el)
  };
}

const INTERACTIVE_TAGS = new Set([
  'a', 'button', 'input', 'select', 'textarea', 'details', 'summary'
]);

const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'menuitem', 'tab', 'checkbox', 'radio',
  'textbox', 'combobox', 'searchbox', 'option', 'switch',
  'menuitemcheckbox', 'menuitemradio', 'treeitem'
]);

function isInteractive(el) {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role');
  return INTERACTIVE_TAGS.has(tag)
    || INTERACTIVE_ROLES.has(role)
    || el.getAttribute('onclick') !== null
    || el.getAttribute('tabindex') !== null
    || el.hasAttribute('contenteditable');
}

// --- Filtering ---

function shouldSkipClick(el) {
  const tag = el.tagName.toLowerCase();
  if (['html', 'body'].includes(tag)) return true;

  // Walk up to find nearest interactive ancestor (max 3 levels)
  let current = el;
  for (let i = 0; i < 3; i++) {
    if (isInteractive(current)) return false;
    if (!current.parentElement) break;
    current = current.parentElement;
  }
  return true;
}

// Bubble up to nearest interactive ancestor
function findBestTarget(el) {
  let current = el;
  for (let i = 0; i < 3; i++) {
    if (isInteractive(current)) return current;
    if (!current.parentElement) break;
    current = current.parentElement;
  }
  return el;
}

// --- Event handlers ---

// Click capture (capture phase to get events before handlers cancel them)
document.addEventListener('click', (e) => {
  if (!recording) return;
  if (shouldSkipClick(e.target)) return;

  const target = findBestTarget(e.target);
  pushEvent({
    type: 'click',
    element: getElementMeta(target),
    coordinates: { x: e.clientX, y: e.clientY }
  });
}, true);

// Debounced text input — only capture final value
document.addEventListener('input', (e) => {
  if (!recording) return;
  const el = e.target;
  if (!['INPUT', 'TEXTAREA'].includes(el.tagName) && !el.hasAttribute('contenteditable')) return;

  const key = el.name || el.id || el.getAttribute('aria-label') || 'unknown_input';

  if (inputTimers.has(key)) clearTimeout(inputTimers.get(key));

  inputTimers.set(key, setTimeout(() => {
    pushEvent({
      type: 'text_input',
      value: el.value || el.textContent || '',
      element: getElementMeta(el)
    });
    inputTimers.delete(key);
  }, DEBOUNCE_MS));
}, true);

// Form submissions
document.addEventListener('submit', (e) => {
  if (!recording) return;
  const form = e.target;
  const formData = {};
  try {
    const fd = new FormData(form);
    for (const [key, value] of fd.entries()) {
      if (typeof value === 'string') {
        formData[key] = value;
      }
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

// Text selection
document.addEventListener('mouseup', () => {
  if (!recording) return;
  const selection = window.getSelection();
  const text = selection?.toString().trim();
  if (text && text.length > 5) {
    pushEvent({
      type: 'text_selection',
      selected_text: text.substring(0, 500),
      parent_element: getElementMeta(selection.anchorNode?.parentElement)
    });
  }
});

// Key presses (only significant keys)
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

// --- Event dispatch ---

function pushEvent(event) {
  seqCounter++;
  event.seq = seqCounter;
  event.timestamp = new Date().toISOString();
  event.url = window.location.href;
  event.page_title = document.title;
  events.push(event);

  // Send to background script for aggregation
  chrome.runtime.sendMessage({
    type: 'EVENT',
    payload: event
  }).catch(() => {
    // Side panel or background may not be ready — ignore
  });
}
