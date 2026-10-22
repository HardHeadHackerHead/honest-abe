# Trademark Policy

## The code is free; the name and logo are not

Abe's source code is licensed under the [GNU AGPL-3.0-or-later](LICENSE). You are free to use, study,
change and share it under the terms of that license.

The **"Abe"** name and the **Abe logo** are trademarks of **Quads Lab**. The AGPL grants rights to the
code. It does not grant rights to use these trademarks. This policy protects users: when someone
downloads "Abe", they should get the official app, not a modified build they can't tell apart from
it.

## Forks and redistributed builds

If you distribute a modified version of Abe, or build and distribute your own binaries, you must
rebrand it:

- **Name:** use a different name that isn't confusingly similar to "Abe" (`productName` in
  `src-tauri/tauri.conf.json`, the window titles, and the text in the UI).
- **Icon and logo:** replace the files in `src-tauri/icons/` and the other branded images
  (`src-tauri/nsis/`, `src-tauri/dmg-resources/`, `public/`).
- **Bundle identifier:** change `io.quadslab.abe` to an identifier you control, so your build doesn't
  overwrite the official app or share its settings and keychain entries.
- **Updater:** build without the `updater` cargo feature, or point `plugins.updater` in
  `src-tauri/tauri.conf.json` to your own endpoint and **your own public key**. Never ship a build
  that installs updates from the official Abe release feed.
- **Links:** update the repository, website and donation links in `src/constants/index.ts`.

You may say that your project is "based on Abe" or "a fork of Abe", as long as it's clear that it
isn't the official app and isn't endorsed by Quads Lab.

## Uses that are always fine

Nominative use, meaning using the name to refer to Abe itself, is fine without asking. For example:

- writing articles, reviews, tutorials or videos about Abe
- linking to the official website or repository
- saying that your software works with Abe or is compatible with it
- building Abe from the unmodified source for your own use

## Questions

If you aren't sure whether your use is fine, or you'd like permission for something this policy
doesn't cover, email [quad@quadslab.io](mailto:quad@quadslab.io).
