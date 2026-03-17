# Skill Recorder

Record a browser demonstration, generate a reusable LLM skill file.

A Chrome Extension captures DOM-level events while you perform a task, then a 3-agent LLM pipeline transforms the event log into a structured SKILL.md or MCP tool definition.

## Architecture

```
Chrome Extension (event capture) → Express Backend (3-agent LLM pipeline) → SKILL.md / MCP tool
```

- **Agent 1 (Context Analyser)**: Extracts goals, interests, constraints from the demonstration
- **Agent 2 (Action Analyser)**: Groups events into logical phases, filters noise
- **Agent 3 (Skill Synthesiser)**: Combines both analyses into a reusable skill document

Agents 1 & 2 run in parallel; Agent 3 consumes both outputs.

## Setup

### Backend

```bash
cd backend
cp .env.example .env
# Edit .env and add your Anthropic API key
npm install
npm start
```

The server runs on `http://localhost:3000`.

### Chrome Extension

1. Open `chrome://extensions` in Chrome
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" and select the `extension/` directory
4. Click the extension icon to open the side panel

## Usage

1. Open the side panel and type what you're going to demonstrate
2. Click **Record** and perform the task in the browser
3. Click **Stop** when done
4. Click **Generate Skill** to send the event log to the backend
5. Review the generated SKILL.md, copy it or export as MCP tool JSON

## Testing the backend independently

```bash
curl -X POST http://localhost:3000/api/process \
  -H 'Content-Type: application/json' \
  -d @sample/example-events.json
```

## References

- Li, J., Ning, Z., Tian, Y., & Li, T. J. (2025). Alloy: Generating Reusable Agent Workflows from User Demonstration. arXiv:2510.10049
- DeploySentinel Recorder — open source Chrome extension for recording browser actions
- Chrome DevTools Recorder — built-in Chrome recording with ARIA + CSS dual selectors
