# FindMyRefs Privacy Policy

_Last updated: 15 October 2026_

FindMyRefs is a desktop application for artists that helps them find and organize visual
references. It is a personal, non-commercial open-source project. This policy explains what data the
app handles and where it goes.

## Summary

- Everything you create in the app (projects, briefs, saved references, notes, board layouts) is
  stored **only on your own computer**.
- The app has **no server** and no user accounts, and it does **not** collect analytics, telemetry or
  advertising data.
- Nothing is sold or shared with third parties.
- The app talks to external services only when you use a feature that needs them, as described below.

## Data stored on your computer

The app keeps a local SQLite database in your user profile (on Windows:
`%APPDATA%\com.findmyrefs.app\findmyrefs.sqlite`). It contains:

- project names and the art briefs you write;
- saved references: title, link to the original page, thumbnail link, creator name and license
  label as provided by the search source (no copies of images are stored);
- your notes, board positions and groups;
- app settings and, if you use the optional Anthropic API, a local log of request counts and token
  usage.

You can delete a project, its references and notes from the Projects screen, and clear usage history
and cached analyses in Settings. Uninstalling the app and deleting the folder above removes all of it.

## Access tokens and API keys

If you choose to connect Pinterest or the Anthropic API, the access token or API key you enter is
stored in the operating system's secure credential store (Windows Credential Manager). It is never
written to the database, shown again in the app, logged, or sent anywhere except to the service it
belongs to. You can remove it in Settings at any time.

## Pinterest

If you connect your Pinterest account:

- The app uses Pinterest's official API only to **search pins by keyword** (read-only scopes
  `pins:read` and `boards:read`) and show them to you as reference results.
- It sends Pinterest the search words you entered and your chosen country code.
- It **never creates, edits or deletes** pins, boards or anything else on your Pinterest account.
- For results you choose to save, it stores only the pin's title, its pinterest.com link and the
  link to Pinterest's image on your computer. Images are displayed from Pinterest's servers and are
  not downloaded, copied or redistributed.
- Pinterest data is not shared with anyone and not used for any purpose other than showing you
  search results.

Pinterest's own handling of data is covered by Pinterest's privacy policy.

## Other services

- **Openverse** (api.openverse.org): when selected as the search source, your search words are sent
  to Openverse to find openly licensed images.
- **Anthropic API** (optional, off by default): only if you add your own API key and explicitly
  start an analysis, your brief text, or the thumbnail link and title of images you select, are sent
  to Anthropic for analysis. This is billed to your own Anthropic account.
- **Opening links**: links you open from the app open in your web browser, which visits those sites
  directly.

Each of these services handles data under its own privacy policy.

## Children

The app is not directed at children under 13 and does not knowingly collect any personal data from
anyone.

## Changes

Changes to this policy will be published in this file in the project's repository, with an updated
date.

## Contact

Questions about this policy can be asked by opening an issue in this project's GitHub repository.
