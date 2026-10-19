# DailyDev Tracker — User Guide

DailyDev Tracker is a VS Code extension for tracking what you work on during the day: which project, what task, and how long it took. It runs quietly in your editor and keeps everything on your own computer — nothing is uploaded anywhere.

## What it does

- **Start/Pause/Resume/Stop a timer** for whatever you're working on, against a project (or a general "Client Support" category for one-off debugging/support work).
- **A dashboard** showing your active task with a live timer, everything you've logged today (or any earlier day), and totals per project.
- **A daily reminder** at a time you choose, so you don't forget to log your work before leaving for the day.
- **A ready-to-send timesheet**: copy a plain-text summary to your clipboard, or export the day's entries as a CSV file.
- **Your data stays private**: everything is stored locally on your machine in an encrypted file. Nothing is sent over the network, ever.

## Installing it

This extension isn't published on the VS Code Marketplace, so it's installed from a `.vsix` file instead. You'll need that file (for example `dailydev-tracker-0.2.0.vsix`) before starting.

### Option A — From within VS Code

1. Open VS Code.
2. Click the **Extensions** icon in the left sidebar (or press `Ctrl+Shift+X` / `Cmd+Shift+X` on Mac).
3. Click the **`...`** (More Actions) menu at the top of the Extensions panel.
4. Choose **Install from VSIX...**.
5. Browse to the `.vsix` file you were given and select it.
6. If VS Code asks you to reload, click **Reload**.

### Option B — From a terminal

If you have the `code` command available in your terminal:

```
code --install-extension path/to/dailydev-tracker-0.2.0.vsix
```

### Confirming it installed

Open the Extensions panel and search for "DailyDev Tracker" under **Installed** — it should show up there. You can also press `Ctrl+Shift+P` (`Cmd+Shift+P` on Mac) to open the Command Palette and type "DailyDev" — you should see a list of its commands.

## Getting started

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **`DailyDev: Start Task`**.
2. Pick an existing project, choose **Client Support**, or add a new project.
3. Type a short description of what you're about to work on, and start.
4. A timer appears in the status bar at the bottom of VS Code. Click it any time for quick Pause / Stop / Switch Task options.
5. Run **`DailyDev: Show Dashboard`** to see today's entries, totals, and the Copy Summary / Export CSV buttons.

## Your data & privacy

Everything you track is stored in an encrypted file on your own computer — it never leaves your machine, and there are no network calls built into the extension at all. If you'd like the technical details (encryption, key storage, file permissions), see the **Privacy & Security** section of [README.md](README.md).

## Getting help

If something isn't working as expected, reach out to whoever shared this extension with you, or open an issue on the project's GitHub repository.
