# Model families, thinking levels, applied settings and Dock app — 2026-10-22

## Verified on this Mac

- Claude 2.1.286's initialize response reports `supportedEffortLevels`
  (low, medium, high, xhigh, max) for Sonnet, Opus and Fable and nothing for
  Haiku 4.5. Codex 0.159.3 `debug models` reports per-model levels plus a default.
  Antigravity exposes the level only inside the model ID. These catalogues are
  the only source of offered levels.
- Native GUI Fetch models on the existing configuration: 21 Claude entries became
  17, grouped by family. Removed: the duplicate `default` alias and three dated or
  `-latest` public duplicates (all disabled). The enabled Sonnet, Opus, Haiku and
  Haiku 5.5 rows kept their state; effort levels were recorded on supporting rows.
- One real request with `reasoning_effort: low` through `claude/sonnet` succeeded
  and the check recorded the effort and served model `claude-sonnet-5-5`. The same
  request for `claude/haiku` was refused with HTTP 422 before reaching the CLI.
  This was a single small account request, not fixture evidence.
- Accessibility tree of the running app: sidebar without Tools, a provider page
  without a Save bar or banner, family sections with alias notes, disclosure
  groups for older versions, one switch per model, a menu bar item labelled
  "OpenBridge, Running".

## Follow-up round

- The app runs as a Dock app (`background only` is false) with App, Edit and
  Window menus and a drawn icon. LSUIElement was removed from the bundle.
- Accessibility tree of the Claude provider page: Version and Account rows,
  no CLI path, Check again, Installation instructions or Capabilities, an
  Advanced disclosure, alias rows labelled “CLI default” with an explanation,
  Thinking pickers inside the text column, Test only on enabled models and a
  single button per Older-versions row (collapsed).
- Public catalogue names are normalised (“Haiku 5.5”) at fetch time and for
  display; stored names are untouched.

## Third round

- Provider pages: one editable title (no second Name row), Sign in only while
  logged out, Advanced as a whole-row toggle holding the program path, family
  shortcuts or manual model entry, no Test button, no thinking pickers. Thinking
  stays on the Bridge page. Verified by accessibility tree on the Claude and
  ChatGPT pages after a rebuild; ChatGPT shows its seven fetched models.
- CLI routes now ignore max_tokens, temperature and similar options and answer
  with `X-OpenBridge-Ignored`; tools and other result-changing options still 422
  (tested over HTTP, JSON and SSE).
- Add provider asks for name, address and key and then loads the model list. The
  sheet was built but not exercised against a real endpoint.
- Bionic's settings page was not consulted: access to that app was declined.

## Not verified

- No screenshots: the screenshot tools could not capture this menu bar app, so
  layout, the dimmed/busy menu bar icon, the system alert and the effort menus
  were not seen. Review these by eye.
- Thinking levels for Codex were checked only against its catalogue and in
  fixtures (`model_reasoning_effort` argument), not with a live request.
- Keychain save/read after rebuild and clean-Mac behaviour remain open (docs/TODO.md).

## Sources

Apple HIG: [Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)
(match the delivery to the importance; show status near what it describes),
[Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts)
(for critical information),
[Windows](https://developer.apple.com/design/human-interface-guidelines/windows)
(avoid critical actions in a bottom bar),
[The menu bar](https://developer.apple.com/design/human-interface-guidelines/the-menu-bar)
(menu bar extras). These support the direction; they do not prescribe this layout.
Codex `-c model_reasoning_effort` is documented in the
[Codex repository](https://github.com/openai/codex).
