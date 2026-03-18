# Skill Recorder

A Chrome extension that watches you perform a task in your browser, generates a structured description of what you did, and copies it to your clipboard. Paste it into any LLM. Get a reusable skill back.

It's like a VBA macro recorder for AI — except instead of recording clicks, it captures what you're actually trying to do.

**No accounts. No API keys. No backend. No storage. No network requests. Nothing leaves your machine unless you paste it.**

## Why

Writing instructions for how to do things in a browser always misses steps. You forget the obvious bits because they're obvious to you. It's like writing a recipe from memory — you'll leave out "preheat the oven" because of course you preheat the oven.

LLMs can already automate browsers. But telling them how to perform a specific task means describing every step in words, and you'll inevitably miss the ones that feel obvious. What if you could just show it?

Skill Recorder flips the direction. Instead of the LLM driving the browser, you drive the browser while the LLM watches. Then it writes the instructions for you.

This is the solution for the long tail of tasks — the ones too specific to your job, your team, your weird internal process, to ever get a proper automation built. The ones that were never going to be automated.

## How It Works

1. Click the extension and type what you're about to demonstrate ("How to download wholesale electricity prices from SEMOpx")
2. Click Record
3. Do the task as you normally would
4. Click Stop
5. A structured description of your demonstration is copied to your clipboard
6. Paste it into any LLM you're authorised to use (Claude, ChatGPT, Gemini, a local model — whatever)
7. The LLM generates a reusable skill from your demonstration

That's it.

## Example

I showed it how to download day-ahead electricity prices from an Irish data portal. Navigate here, click that filter, switch to table view, hit export.

The extension captured the demonstration. I pasted it into Claude. It generated a [skill file](examples/sem-market-data.md) that understood the date format (DD/MM/YYYY), knew the page defaults to chart view and you need to switch to table, and identified that the download link triggers a JavaScript action rather than a simple file download.

Now I can just say: "Can you get the day-ahead SEM prices for Monday for me please?", and it does.

## Install

### Chrome Web Store (recommended)

[Install from Chrome Web Store](link-to-listing)

### Manual install from source

1. Download or clone this repo
2. Open `chrome://extensions`
3. Enable "Developer mode" (top right)
4. Click "Load unpacked"
5. Select the `extension/` folder
6. Pin the extension to your toolbar

## Privacy

Skill Recorder is stateless. It stores nothing. It sends nothing. It makes no network requests. The extension captures browser events in memory while you're recording, formats them as text, copies that text to your clipboard, and forgets everything.

The only way data leaves your machine is when you paste the clipboard into an LLM — and you choose which LLM, when, and you can read and redact the clipboard content first.

This was a deliberate architectural choice. An earlier version had a built-in LLM backend, but that meant the extension needed network access and API keys — a security nightmare. Splitting it into "record locally, paste manually" means the extension needs almost no permissions and IT teams can actually audit it. It also means it doesn't care which LLM you are using.

[Full privacy policy](PRIVACY.md)

## What It Captures

The extension records meaningful browser interactions during a recording session:

- **Clicks** on interactive elements (buttons, links, form controls) — not clicks on background or layout elements
- **Text input** (final values only, debounced — not individual keystrokes)
- **Form submissions** with field values
- **Navigation** with transition type (typed URL, clicked link, back/forward)
- **Text selections** (what the user highlighted/read)
- **Tab switches** and new tab creation

It does not capture:

- Anything outside a recording session
- Passwords or credentials (though you should avoid logging into sites during recording — see below)
- Screenshots or visual content
- Network requests or response data
- Cookies or local storage

### A note on sensitive data

The clipboard output will contain URLs you visited, text you typed into forms, and descriptions of page elements you interacted with during recording. **Don't record yourself doing anything sensitive.** If you accidentally include something you shouldn't have, read the clipboard content and redact it before pasting.

## What the LLM Gets

The clipboard contains a structured prompt with:

- Your declared intent ("what I'm about to show you")
- A chronological event log with element metadata (tag, role, aria-label, text content)
- Instructions asking the LLM to generate a reusable skill at the task level, not the click level

The LLM turns "clicked element with aria-label 'Search', typed 'iPhone 17 Pro', clicked link with text 'Apple — iPhone 17 Pro Specifications'" into "search for {product_name} specifications on the manufacturer's website." That abstraction is what makes the skill reusable when the interface changes.

## Limitations

This is a proof of concept, not a product.

- The quality of the generated skill depends entirely on the LLM you paste into. Better models produce better skills.
- Complex demonstrations (many tabs, long sessions) may produce event logs that exceed context windows on smaller models.
- The extension records DOM-level events. It doesn't know what happened visually — if a page shows a loading spinner for 3 seconds, the extension only sees the content that appears after.
- Single-page apps with heavy JavaScript may produce noisier event logs than traditional multi-page sites.
- It won't help with tasks that aren't browser-based.

## Fork It

The extension is deliberately simple — a few hundred lines of event listeners, filtering logic, a formatter, and a clipboard write. It's designed to be forked and adapted:

- Swap the output format to generate Playwright or Puppeteer scripts instead of LLM prompts
- Add voice narration capture via Web Speech API for richer context
- Add the MutationObserver layer (see the [spec document](SPEC.md)) to capture page state changes
- Wire it into your company's internal tool builder
- Change the prompt template for your specific use case
- Build a local skill library on top of it

## Background

This project started as a conversation with Claude. I was frustrated trying to get data from a clunky portal and wondered: Claude can already automate Chrome — what if you could do it the other way round?

The research (that Claude did) turned up an academic paper — [Alloy (Li et al., 2025)](https://arxiv.org/abs/2510.10049) — that describes a system for generating reusable agent workflows from user demonstrations. Nobody had shipped a lightweight tool based on the idea. Claude wrote a [spec](SPEC.md), Claude Code built the extension..

The full story: [link to Substack post]

### References

- Li, J., Ning, Z., Tian, Y., & Li, T. J. (2025). [Alloy: Generating Reusable Agent Workflows from User Demonstration](https://arxiv.org/abs/2510.10049). arXiv:2510.10049
- [DeploySentinel Recorder](https://github.com/DeploySentinel/Recorder) — open source Chrome extension for recording browser actions. Reference for content script patterns.
- [Chrome DevTools Recorder](https://developer.chrome.com/docs/devtools/recorder) — built-in Chrome recording with robust selector generation.
- [Skyvern](https://github.com/Skyvern-AI/skyvern) — browser automation with LLMs, has an "Action Recorder" on their roadmap.

## Licence

MIT
