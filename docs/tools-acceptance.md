# Sticky actions and update-only Tools — 2026-10-22

- Provider Save changes is a safe-area bottom inset outside the Form. Verified at
  the top and after scrolling through the long Claude catalogue. An unsaved name
  edit enabled Save changes; restoring the name disabled it. No test edit saved.
- Tools shows Claude 2.1.286, Codex 0.159.3 and agy 1.4.5 on this Mac. These are
  installed versions, not claims of newest availability. Version checks use each
  CLI's --version; account access and Google isolation remain separate states.
- Previewed existing Claude and Codex native update commands in the real GUI.
  No actual vendor updater or installer was run. All install execution paths
  were removed following the user's update-only scope clarification.
- 20 Node tests pass, including admin-only maintenance, 503 inference pause,
  refusal during an active request and refusal of overlapping maintenance.
- scripts/check-native.sh passes command-route, unknown/missing CLI refusal,
  npm prefix/path, merged error output and 64 KiB output-bound fixtures.
- Native app builds. Provider names, keys, selected models and enabled flags kept.
  Real vendor downloads/updates, permission failures and clean-Mac behavior are
  not end-to-end verified by these fixtures or command previews.

Local ignored evidence:
[sticky footer](../build/ui-review/sticky-save.png),
[update preview](../build/ui-review/cli-maintenance.png).

Sources: [Apple safe-area inset](https://developer.apple.com/documentation/swiftui/view/safeareainset(edge:alignment:spacing:content:)-4s51l)
supports reserving space for a bottom view, so the action does not obscure the
last form rows. This is an implementation fit, not a mandate for this exact bar.
[Claude setup/update](https://code.claude.com/docs/en/setup),
[Codex CLI](https://learn.chatgpt.com/docs/codex/cli), and
[Antigravity quickstart](https://www.antigravity.google/docs/getting-started?tab=cli)
provide vendor setup guidance; installed updater help was also inspected.
