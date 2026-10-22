# Contributing to Abe

Thanks for helping improve Abe. This guide covers setting up a development build, the checks every
change has to pass, and how to send a pull request.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Reporting bugs

Open an issue with the **Bug report** template:
<https://github.com/HardHeadHackerHead/honest-abe/issues/new/choose>

Include your OS, your Abe version, which engine you use (local, or cloud and which provider), the
steps to reproduce the problem, and any error messages.

**Never paste an API key** into an issue, a log or a screenshot. If you posted one by accident,
revoke it with your provider right away.

Security problems should not be reported in public issues. See [SECURITY.md](SECURITY.md).

For feature ideas, use the **Feature request** template. For larger changes, please open an issue to
discuss the idea before you write the code, so no one's work is wasted.

## Development setup

1. Install the prerequisites for your platform: Node.js 20 or later, Rust (stable), a C/C++
   toolchain, CMake and libclang. See
   [Building from source](README.md#building-from-source) in the README.
2. Clone the repo and install the dependencies:

   ```bash
   git clone https://github.com/HardHeadHackerHead/honest-abe.git
   cd honest-abe
   npm install
   ```

3. Run the app in development mode:

   ```bash
   npm run tauri dev
   ```

The first build compiles whisper.cpp and takes a few minutes. Later builds are incremental.

You don't need any accounts or keys to work on Abe. Local mode works offline. To test cloud mode,
use your own key; Groq has a free tier.

## Checks

There is no CI, so please run these locally before you open a pull request and say in the PR that they pass:

```bash
# Frontend
npx tsc --noEmit
npx vite build
npm test --if-present

# Rust (from src-tauri/)
cargo clippy --all-targets -- -D warnings
cargo test
```

## Coding standards

- **TypeScript:** strict mode, no `any` unless there is no reasonable alternative. Follow the patterns
  of the code around your change; components live in `src/components`, hooks in `src/hooks`, and Tauri
  command wrappers in `src/services`.
- **Rust:** keep `clippy` warning-free, and run `rustfmt` on the files you change (formatting isn't
  enforced yet). Return errors instead of
  panicking in command handlers. Platform-specific code goes behind `#[cfg(target_os = ...)]`.
- **Tests:** add or update tests for logic you change, especially in `src-tauri/src/engine`.
  Network tests use `wiremock`; tests must not call real providers or need API keys.
- **Privacy:** Abe has no servers and no telemetry, and it must stay that way. Don't add analytics,
  crash reporting or any network request the user didn't ask for. New permissions in
  `src-tauri/capabilities` need a reason in the PR description.
- **Dependencies:** prefer fewer. New dependencies must have a license compatible with
  AGPL-3.0-or-later (MIT, Apache-2.0, BSD, ISC, MPL-2.0, and similar).
- Keep each pull request focused on one change. Unrelated refactors belong in their own PR.

## Commit messages

- Write the subject line in the imperative mood ("Fix paste on Wayland", not "Fixed paste"), with no
  more than about 72 characters and no trailing period.
- Leave a blank line after the subject, then explain *why* the change is needed if it isn't obvious.
- Reference issues with `Fixes #123` where it applies.

## Developer Certificate of Origin (DCO)

Abe uses the [Developer Certificate of Origin](https://developercertificate.org/) instead of a
contributor license agreement. By signing off a commit, you certify that you wrote the change or
otherwise have the right to submit it under the project's license (AGPL-3.0-or-later).

Sign off every commit with `-s`:

```bash
git commit -s -m "Fix paste in terminal apps"
```

This adds a trailer with your name and email:

```text
Signed-off-by: Your Name <you@example.com>
```

Use your real name (or the name you're known by) and a working email address. To sign off commits you
already made on your branch, run `git rebase --signoff main` and then force-push the branch.

## Pull requests

1. Fork the repo and create a branch from `main`.
2. Make your change, with tests where it makes sense.
3. Run the checks above.
4. Open a pull request and fill in the template: what changed, why, and how you tested it. Include
   screenshots for UI changes and say which platforms you tested on.
5. A maintainer will review it. Please respond to review comments by pushing new commits to the same
   branch.

The checks above must pass and every commit needs a DCO sign-off before a PR can be merged.

## License

Your contributions are licensed under [AGPL-3.0-or-later](LICENSE), the same license as the rest of
Abe.
