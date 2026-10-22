# Security Policy

## Supported versions

Only the latest release of Abe gets security fixes. Official builds update themselves, so please
make sure you're on the [latest release](https://github.com/HardHeadHackerHead/honest-abe/releases/latest)
before you report a problem.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

**Please don't report security problems in public issues, discussions or pull requests.**

Report them privately in one of these ways:

1. **GitHub Security Advisories (preferred):** open the
   [Security tab](https://github.com/HardHeadHackerHead/honest-abe/security) and click
   **Report a vulnerability**.
2. **Email:** [support@getabe.app](mailto:support@getabe.app), with "Security" in the subject line.

Please include:

- the Abe version and your OS
- a description of the problem and its impact
- steps to reproduce it, or a proof of concept
- any suggested fix

Don't include real API keys or other people's data. If a key may have been exposed, revoke it with
the provider.

We aim to acknowledge reports within 3 business days and to agree on a fix and disclosure timeline
with you. We're happy to credit you in the release notes unless you'd rather stay anonymous.

## Scope

Abe has **no servers, accounts or backend**. Audio and text go either nowhere (local mode) or
directly from your computer to the provider you configured. That means there is no Abe service to
attack, and problems with Groq, OpenAI or another provider should be reported to that provider.

In scope:

- **The desktop app:** the Rust backend in `src-tauri`, the React UI in `src`, and the Tauri
  configuration and capabilities. Examples are a webview escape, a command that's exposed to a window
  that shouldn't have it, API keys leaking out of the OS keychain or into logs, local model downloads
  that aren't verified, and insecure handling of the clipboard or the global hotkeys.
- **The release pipeline:** the GitHub Actions workflows in `.github/workflows`, the release scripts
  in `scripts/`, the auto-updater (`latest.json`, signature verification), and the installers.

Out of scope:

- the getabe.app website, which is a static site
- vulnerabilities in third-party providers or their APIs
- problems that need an already-compromised machine or physical access
- unofficial builds and forks
