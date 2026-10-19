# Change Log

All notable changes to the "dailydev-tracker" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

- The "Stopped" notification (from Stop Task or Switch Task) now also shows today's running total tracked time.

## [0.2.0]

Security & data protection.

- The SQLite data file is now encrypted at rest (AES-256-GCM), with the key stored in your OS keychain via VS Code's `SecretStorage` API (falling back to a restricted local file if no keychain is available).
- The data file (and fallback key file) is restricted to the current OS user.
- A pre-existing plaintext database from 0.1.0 is migrated to the encrypted format automatically on first load.
- An ESLint rule now fails the build if any networking API (`http`/`https`/`net`/`dgram`/`tls`/`fetch`) is ever imported, enforcing the "no network calls" invariant.
- CSV export now warns that the exported file is plain text before writing it.

## [0.1.0]

First feature-complete release.

- Project and task management with a Client Support category, backed by a local SQLite store.
- Automatic time tracking: start/pause/resume/stop/switch, a live status bar timer, and crash recovery for an unfinished session after a VS Code restart.
- Task dashboard: active task with live timer, today's entries with project totals, inline editing, backdated/forgotten entries, and navigation to review any past day.
- Daily timesheet summary: Copy Summary to clipboard and CSV export.
- Configurable daily reminder with working-day scheduling and missed-reminder catch-up.