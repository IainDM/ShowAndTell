# Privacy Policy — Skill Recorder

## Summary

Skill Recorder stores nothing, sends nothing, and makes no network requests. It captures browser events in memory during a recording session, copies a text description to your clipboard, and forgets everything.

## What the extension does

During an active recording session (and only during an active recording session), Skill Recorder captures browser events — clicks, text input, form submissions, navigation, and tab switches — along with metadata about the elements you interacted with (tag name, aria-label, role, text content, etc.).

When you stop recording, this data is formatted as structured text, copied to your clipboard, and discarded from memory. The extension retains nothing between sessions.

## What the extension does not do

- **No network requests.** The extension makes no HTTP requests, API calls, or connections of any kind. It has no network access permissions.
- **No data storage.** Nothing is written to Chrome's local storage, IndexedDB, cookies, or the filesystem.
- **No background activity.** Outside an active recording session, the extension does nothing.
- **No data collection.** No analytics, no telemetry, no crash reports, no usage tracking.
- **No third-party services.** No APIs, no backends, no CDNs, no scripts loaded from external sources.

## How data leaves your machine

The only way recorded data leaves your machine is when you manually paste the clipboard contents into an application of your choosing (such as an LLM chat interface). You control when this happens, which application receives it, and you can read and edit the clipboard contents before pasting.

## Sensitive data

The clipboard output may contain URLs you visited, text you entered into form fields, and descriptions of page elements during recording. You should not record sessions that involve sensitive information such as passwords, personal data, or confidential material. If sensitive data is captured accidentally, review and redact the clipboard contents before pasting.

## Permissions

The extension requests only the minimum permissions required:

- `activeTab` — to inject the content script into the current page during recording
- `scripting` — to inject the content script into new tabs opened during recording
- `webNavigation` — to capture page navigation events with transition metadata
- `tabs` — to track tab switches during recording
- `clipboardWrite` — to copy the formatted output to your clipboard

No `host_permissions` for external domains. No `storage` permission. No network-related permissions.

## Contact

[Link to GitHub Issues]
