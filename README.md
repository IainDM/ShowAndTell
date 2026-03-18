# Skill Recorder

Record a browser demonstration, generate a reusable LLM skill file.

A Chrome Extension captures DOM-level events while you perform a task. You then paste the captured event log (with a bundled prompt) into any LLM to generate a structured SKILL.md or MCP tool definition.

## Architecture

The tool and the LLM are cleanly separated:

```
Chrome Extension (event capture)  →  JSON event log + prompt  →  Any LLM  →  SKILL.md
       (non-AI tool)                    (the interface)          (your choice)
```

The extension is fully self-contained. No API key or backend server required.

An optional Express backend is included for API-powered generation if you have an Anthropic API key.

## Setup

### Chrome Extension

1. Open `chrome://extensions` in Chrome
2. Enable "Developer mode" (top right)
3. Click "Load unpacked" and select the `extension/` directory
4. Click the extension icon to open the side panel

That's it. No backend needed.

## Usage

1. Open the side panel and type what you're going to demonstrate
2. Click **Record** and perform the task in the browser
3. Click **Stop** when done
4. Export your recording:
   - **Copy Prompt for Claude** — copies a ready-to-paste prompt with your event log embedded. Paste into claude.ai (or any LLM) and get back a SKILL.md
   - **Copy Event Log (JSON)** — copies the raw JSON for custom processing
   - **Download JSON** — saves the event log as a file

### Using with Claude (no API key needed)

1. Record your demonstration
2. Click **Copy Prompt for Claude**
3. Open claude.ai and paste
4. Claude will output a structured SKILL.md

The prompt bundles the event log with instructions for context analysis, action analysis, and skill synthesis — the same 3-step pipeline the backend uses.

### Using with the API backend (optional)

If you have an Anthropic API key and want automated generation:

```bash
cd backend
cp .env.example .env
# Edit .env and add your Anthropic API key
npm install
npm start
```

Then use the "Generate via API" option in the side panel. The server runs a 3-agent pipeline:
- **Agent 1 (Context Analyser)** + **Agent 2 (Action Analyser)** run in parallel
- **Agent 3 (Skill Synthesiser)** combines both into SKILL.md

### Testing the backend independently

```bash
curl -X POST http://localhost:3000/api/process \
  -H 'Content-Type: application/json' \
  -d @sample/example-events.json
```

## References

- Li, J., Ning, Z., Tian, Y., & Li, T. J. (2025). Alloy: Generating Reusable Agent Workflows from User Demonstration. arXiv:2510.10049
- DeploySentinel Recorder — open source Chrome extension for recording browser actions
- Chrome DevTools Recorder — built-in Chrome recording with ARIA + CSS dual selectors
