## What does this change?

<!-- A short description of the change, and why it's needed. Link the issue it fixes: "Fixes #123". -->

## How was it tested?

<!-- What you ran or tried. Include screenshots or a short recording for UI changes. -->

Tested on:

- [ ] Windows
- [ ] macOS
- [ ] Linux

## Checklist

- [ ] Every commit is signed off for the [DCO](https://developercertificate.org/) (`git commit -s`). See [CONTRIBUTING.md](../CONTRIBUTING.md#developer-certificate-of-origin-dco).
- [ ] `npx tsc --noEmit` passes.
- [ ] `cargo clippy --all-targets -- -D warnings` and `cargo test` pass in `src-tauri`.
- [ ] No new network requests, telemetry or permissions, or they're explained above.
- [ ] No API keys, tokens or personal paths in the code, tests or screenshots.
