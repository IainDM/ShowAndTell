import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let systemPrompt = null;

async function getSystemPrompt() {
  if (!systemPrompt) {
    systemPrompt = await readFile(join(__dirname, '..', 'prompts', 'action.txt'), 'utf-8');
  }
  return systemPrompt;
}

/**
 * Agent 2: Action Analyser
 * Groups events into logical phases, identifies noise/corrections, finds dependencies.
 */
export async function analyseActions(client, intent, events) {
  const prompt = await getSystemPrompt();

  // Build a compact representation focusing on action sequence
  const compactEvents = events.map(e => {
    const entry = { seq: e.seq, type: e.type, timestamp: e.timestamp };
    if (e.url) entry.url = e.url;
    if (e.value) entry.value = e.value;
    if (e.selected_text) entry.selected_text = e.selected_text;
    if (e.key) entry.key = e.key;
    if (e.method) entry.method = e.method;
    if (e.form_data) entry.form_data = e.form_data;
    if (e.transition_type) entry.transition_type = e.transition_type;
    if (e.is_back_forward) entry.is_back_forward = true;
    if (e.page_title) entry.page_title = e.page_title;
    if (e.coordinates) entry.coordinates = e.coordinates;
    if (e.element) {
      const el = e.element;
      entry.element = {};
      if (el.tag) entry.element.tag = el.tag;
      if (el.aria_label) entry.element.aria_label = el.aria_label;
      if (el.role) entry.element.role = el.role;
      if (el.name) entry.element.name = el.name;
      if (el.text) entry.element.text = el.text.substring(0, 100);
      if (el.href) entry.element.href = el.href;
      if (el.placeholder) entry.element.placeholder = el.placeholder;
      if (el.type) entry.element.type = el.type;
      if (el.label) entry.element.label = el.label;
    }
    return entry;
  });

  const userMessage = `Intent: ${intent}\n\nEvent Log:\n${JSON.stringify(compactEvents, null, 2)}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    temperature: 0,
    system: prompt,
    messages: [{ role: 'user', content: userMessage }]
  });

  const text = response.content[0]?.text || '';

  try {
    return JSON.parse(text);
  } catch {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    console.warn('Action Analyser returned non-JSON response:', text.substring(0, 200));
    return { raw_response: text, phases: [], noise_events: [], dependencies: [], parallelisable: [] };
  }
}
