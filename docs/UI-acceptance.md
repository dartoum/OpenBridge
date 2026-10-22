# English UI and protocol acceptance — 2026-10-22

1. User screenshots showed Dutch labels, small caption text and technical errors
   determining the notification/model row width. The detail column now has an
   explicit geometry constraint, a two-line notification and a Details sheet.
2. Native app inspection confirmed English overview, provider pages, menus,
   diagnostics and add-provider labels. Main text is 14pt; secondary text and IDs
   are 13pt rather than caption size. Only the exact shipped Dutch default Codex
   label is migrated; custom names are retained.
3. A temporary localhost API returned an approximately 850-character error with
   repeated unbroken IDs. The sidebar/window stayed stable; the model row showed
   Request failed + Details. The sheet wrapped and scrolled the full error.
   Copy details was pasted into an unsaved field and verified, then cleared.
   Notification dismissal worked. The fixture provider/server were removed.
4. Google Test reproduced the existing text-only isolation blocker; the UI
   accurately reports it. No provider permissions were changed.

Local visual evidence (ignored build output):
[bounded error](../build/ui-review/long-error.png),
[details sheet](../build/ui-review/error-details.png).

The font change follows Apple's emphasis on readable text, rather than treating
its minimum size as the target. Short visible errors plus inspectable details
follow its advice to keep alert text concise:
[Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility),
[Apple alerts](https://developer.apple.com/design/human-interface-guidelines/alerts).
These support the direction; they do not prescribe this exact banner design.

Protocol verification: local tests pass, including real localhost HTTP
forwarding of generation options, text arrays, a function-call/result cycle,
fragmented streamed tool arguments, usage and finish reasons, and an incomplete
SSE stream. The upstream fixture receives the original request with only the
model ID replaced. CLI routes reject unsupported controls/functions with 422.
See the [Chat Completions schema](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).
No claim of a live GOAT/OpenCode function-calling run, clean-Mac install, or
exhaustive window-size/accessibility acceptance. Existing keys/config retained.
