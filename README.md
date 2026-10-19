# DailyDev Tracker

Track daily tasks and project-wise working time directly from VS Code — start/pause/stop a timer, review a dashboard of today's (or any past day's) work, get a configurable end-of-day reminder, and copy or export a ready-to-send timesheet.

## Features

- **Start/Pause/Resume/Stop/Switch** a task against a project or "Client Support" (for debugging/troubleshooting work that isn't tied to a specific project).
- **Status bar timer** — click it for a quick Pause/Stop/Switch menu while a task is running.
- **Dashboard** (`DailyDev: Show Dashboard`) — the active task with a live timer, today's entries with project totals, inline editing, backdated/forgotten-entry entry, and navigation to review any past day.
- **Copy Summary / Export CSV** from the dashboard — a project-grouped, timesheet-ready summary for pasting into a company timesheet, or a CSV for the same day's entries.
- **Daily reminder** at a configurable time and set of working days, with catch-up if VS Code was closed when it was due.
- **Crash recovery** — an unfinished session survives a VS Code restart and is restored on next launch.
- All data is stored locally, encrypted at rest, under VS Code's per-extension storage; nothing is sent over the network. See [Privacy & Security](#privacy--security).

## Commands

| Command | Description |
|---|---|
| `DailyDev: Start Task` | Pick a project (or Client Support) and describe the task to begin tracking. |
| `DailyDev: Add Project` | Add a new project without starting a task. |
| `DailyDev: Switch Task` | Stop the current task and start a new one in one step. |
| `DailyDev: Pause Task` / `DailyDev: Resume Task` | Pause or resume the active task's timer. |
| `DailyDev: Stop Task` | Stop and record the active task. |
| `DailyDev: Task Menu` | Quick menu for the active task (Pause/Resume/Stop/Switch). |
| `DailyDev: Correct Entry Duration` | Fix the duration of a past entry. |
| `DailyDev: Show Dashboard` | Open the task dashboard. |

## Extension Settings

This extension contributes the following settings (`Ctrl+,` → search "DailyDev"):

- `dailydevTracker.reminderEnabled` — show a daily reminder to review tracked tasks (default: `true`).
- `dailydevTracker.reminderTime` — 24-hour `HH:mm` time for the reminder (default: `18:00`).
- `dailydevTracker.workingDays` — which weekdays to show the reminder on (default: Mon–Fri).

## Privacy & Security

This extension is built to hold real client/project names and task descriptions from your employer's work, so it's designed to keep that data local and protected:

- **No network calls, ever.** Nothing is sent anywhere — enforced by an ESLint rule that fails the build if `http`/`https`/`net`/`dgram`/`tls`/`fetch` is ever imported.
- **Encrypted at rest.** The SQLite data file is encrypted with AES-256-GCM. The key is generated once and stored in your OS's secure credential store (Windows Credential Manager, macOS Keychain, or Linux Secret Service) via VS Code's `SecretStorage` API — not in the file itself.
  - If no OS keychain is available (e.g. a Linux/WSL setup without a secret-service daemon), the key falls back to a local file restricted to your user account, so the extension still works without hanging on startup. Either way, the data file itself is always encrypted.
- **Restricted file permissions.** The data file (and the fallback key file, if used) is set to be readable only by your OS user account.
- **A corrupted or unreadable data file never bricks the extension** — it's quarantined (renamed, not deleted) and a fresh database is started.
- **CSV exports are plain text by nature** — the dashboard warns you before exporting, since an exported file is no longer protected by the above.
- **Scope of protection:** this defends against someone copying the data file later (a backup, a stolen laptop, another user account on the same machine). It is not a defense against malware already running as your own user — no desktop app sandboxing can prevent that.

## Known Issues

- The occasional test run can hit timing flakiness under heavy load in a resource-constrained dev container (e.g. WSL2); this reflects test-environment contention, not a product bug.

## Release Notes

### 0.2.0

Encryption at rest, OS-keychain-backed key storage (with a safe local-file fallback), restricted file permissions, a no-network-calls lint guard, and a warning before CSV export.

### 0.1.0

First feature-complete release: project/task management, automatic time tracking with pause/resume/switch and crash recovery, the task dashboard, scheduled reminders, and the daily timesheet summary (copy/export/past-day review).
