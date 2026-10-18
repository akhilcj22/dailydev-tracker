import * as vscode from 'vscode';
import * as db from './db';
import * as session from './session';
import { pickTaskTarget, promptForTaskDescription } from './taskPicker';
import { formatDuration } from './time';

let panel: vscode.WebviewPanel | undefined;
let tickInterval: ReturnType<typeof setInterval> | undefined;

interface DashboardEntry {
	id: number;
	projectName: string;
	description: string;
	startLabel: string;
	durationLabel: string;
	durationSeconds: number;
}

interface ProjectTotal {
	projectName: string;
	totalLabel: string;
}

interface ActiveInfo {
	label: string;
	description: string;
	elapsedLabel: string;
	paused: boolean;
}

interface DashboardState {
	active: ActiveInfo | null;
	entries: DashboardEntry[];
	totals: ProjectTotal[];
	grandTotalLabel: string;
}

function getTodayBounds(): { startIso: string; endIso: string } {
	const now = new Date();
	const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
	return { startIso: start.toISOString(), endIso: end.toISOString() };
}

function buildState(context: vscode.ExtensionContext): DashboardState {
	const activeSession = session.getSession(context);
	const active: ActiveInfo | null = activeSession
		? {
				label: activeSession.label,
				description: activeSession.description,
				elapsedLabel: formatDuration(session.computeElapsedMs(activeSession)),
				paused: !!activeSession.pausedAt
			}
		: null;

	const { startIso, endIso } = getTodayBounds();
	const logs = db.listFinishedWorkLogsBetween(startIso, endIso);

	const entries: DashboardEntry[] = logs.map((log) => ({
		id: log.id,
		projectName: log.projectName,
		description: log.description,
		startLabel: new Date(log.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
		durationLabel: formatDuration((log.durationSeconds ?? 0) * 1000),
		durationSeconds: log.durationSeconds ?? 0
	}));

	const totalsByProject = new Map<string, number>();
	for (const entry of entries) {
		totalsByProject.set(entry.projectName, (totalsByProject.get(entry.projectName) ?? 0) + entry.durationSeconds);
	}
	const totals: ProjectTotal[] = [...totalsByProject.entries()].map(([projectName, totalSeconds]) => ({
		projectName,
		totalLabel: formatDuration(totalSeconds * 1000)
	}));
	const grandTotalSeconds = entries.reduce((sum, entry) => sum + entry.durationSeconds, 0);

	return { active, entries, totals, grandTotalLabel: formatDuration(grandTotalSeconds * 1000) };
}

function postState(context: vscode.ExtensionContext): void {
	panel?.webview.postMessage({ type: 'state', state: buildState(context) });
}

function startTicking(context: vscode.ExtensionContext): void {
	stopTicking();
	tickInterval = setInterval(() => postState(context), 1000);
}

function stopTicking(): void {
	if (tickInterval) {
		clearInterval(tickInterval);
		tickInterval = undefined;
	}
}

async function editEntry(id: number): Promise<void> {
	const log = db.getWorkLog(id);
	if (!log) {
		return;
	}
	const choice = await vscode.window.showQuickPick(['Edit duration', 'Edit description'], {
		placeHolder: log.description
	});
	if (!choice) {
		return;
	}
	if (choice === 'Edit duration') {
		const minutesInput = await vscode.window.showInputBox({
			prompt: `Corrected duration in minutes for "${log.description}"`,
			value: String(Math.round((log.durationSeconds ?? 0) / 60)),
			validateInput: (value) =>
				/^\d+$/.test(value.trim()) && Number(value.trim()) > 0
					? undefined
					: 'Enter a whole number of minutes greater than 0'
		});
		if (!minutesInput) {
			return;
		}
		db.updateWorkLogDuration(id, Number(minutesInput.trim()) * 60);
	} else {
		const newDescription = await vscode.window.showInputBox({
			prompt: 'Task description',
			value: log.description,
			validateInput: (value) => (value.trim() ? undefined : 'Description cannot be empty')
		});
		if (!newDescription) {
			return;
		}
		db.updateWorkLogDescription(id, newDescription.trim());
	}
}

async function addMissingEntry(): Promise<void> {
	const target = await pickTaskTarget();
	if (!target) {
		return;
	}
	const description = await promptForTaskDescription();
	if (!description) {
		return;
	}
	const minutesInput = await vscode.window.showInputBox({
		prompt: 'How many minutes did you spend on this?',
		placeHolder: '45',
		validateInput: (value) =>
			/^\d+$/.test(value.trim()) && Number(value.trim()) > 0
				? undefined
				: 'Enter a whole number of minutes greater than 0'
	});
	if (!minutesInput) {
		return;
	}
	const durationSeconds = Number(minutesInput.trim()) * 60;
	const endTime = new Date().toISOString();
	const startTime = new Date(Date.now() - durationSeconds * 1000).toISOString();
	db.addFinishedWorkLog({
		projectId: target.projectId,
		category: target.category,
		description,
		startTime,
		endTime,
		durationSeconds
	});
	vscode.window.showInformationMessage(`Added: ${target.label} — ${description} (${minutesInput.trim()} min)`);
}

function getNonce(): string {
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

function getHtml(): string {
	const nonce = getNonce();
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>DailyDev Tracker</title>
<style>
	body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; }
	h2, h3 { margin-top: 0; }
	.section-header { display: flex; justify-content: space-between; align-items: center; }
	.active-card { border: 1px solid var(--vscode-widget-border, #444); border-radius: 6px; padding: 12px; margin-bottom: 20px; }
	.active-card.idle { opacity: 0.7; }
	.timer { font-size: 28px; font-variant-numeric: tabular-nums; margin: 8px 0; }
	.buttons button { margin-right: 8px; }
	button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; border-radius: 3px; cursor: pointer; }
	button:hover { background: var(--vscode-button-hoverBackground); }
	button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
	table { width: 100%; border-collapse: collapse; margin-top: 8px; }
	th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--vscode-widget-border, #333); }
	tr:hover { background: var(--vscode-list-hoverBackground); }
	.totals { margin-top: 20px; }
	.muted { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
	.edit-link { cursor: pointer; color: var(--vscode-textLink-foreground); }
</style>
</head>
<body>
	<div class="section-header">
		<h2>Today</h2>
		<button id="addEntryBtn">+ Add forgotten entry</button>
	</div>

	<div id="activeCard" class="active-card idle">
		<div class="muted">No active task</div>
		<div class="buttons"><button id="startBtn">Start Task</button></div>
	</div>

	<table id="entriesTable">
		<thead><tr><th>Project</th><th>Task</th><th>Start</th><th>Duration</th><th></th></tr></thead>
		<tbody id="entriesBody"><tr><td colspan="5" class="muted">No entries yet today.</td></tr></tbody>
	</table>

	<div class="totals">
		<h3>Project Totals</h3>
		<table id="totalsTable"><tbody id="totalsBody"></tbody></table>
		<p><strong>Total: <span id="grandTotal">00:00:00</span></strong></p>
	</div>

<script nonce="${nonce}">
	const vscode = acquireVsCodeApi();

	function send(type, extra) { vscode.postMessage(Object.assign({ type }, extra)); }

	function escapeHtml(s) {
		return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
	}

	document.getElementById('addEntryBtn').addEventListener('click', () => send('addEntry'));

	function renderActive(active) {
		const card = document.getElementById('activeCard');
		if (!active) {
			card.classList.add('idle');
			card.innerHTML = '<div class="muted">No active task</div><div class="buttons"><button id="startBtn">Start Task</button></div>';
			document.getElementById('startBtn').addEventListener('click', () => send('start'));
			return;
		}
		card.classList.remove('idle');
		card.innerHTML =
			'<div>' + escapeHtml(active.label) + ' — ' + escapeHtml(active.description) + (active.paused ? ' <span class="muted">(paused)</span>' : '') + '</div>' +
			'<div class="timer">' + active.elapsedLabel + '</div>' +
			'<div class="buttons">' +
				(active.paused ? '<button id="resumeBtn">Resume</button>' : '<button id="pauseBtn">Pause</button>') +
				'<button id="stopBtn" class="secondary">Stop</button>' +
				'<button id="switchBtn" class="secondary">Switch Task</button>' +
			'</div>';
		const resumeBtn = document.getElementById('resumeBtn');
		if (resumeBtn) { resumeBtn.addEventListener('click', () => send('resume')); }
		const pauseBtn = document.getElementById('pauseBtn');
		if (pauseBtn) { pauseBtn.addEventListener('click', () => send('pause')); }
		document.getElementById('stopBtn').addEventListener('click', () => send('stop'));
		document.getElementById('switchBtn').addEventListener('click', () => send('switch'));
	}

	function renderEntries(entries) {
		const body = document.getElementById('entriesBody');
		if (!entries.length) {
			body.innerHTML = '<tr><td colspan="5" class="muted">No entries yet today.</td></tr>';
			return;
		}
		body.innerHTML = entries.map((e) =>
			'<tr>' +
				'<td>' + escapeHtml(e.projectName) + '</td>' +
				'<td>' + escapeHtml(e.description) + '</td>' +
				'<td>' + e.startLabel + '</td>' +
				'<td>' + e.durationLabel + '</td>' +
				'<td><span class="edit-link" data-id="' + e.id + '">Edit</span></td>' +
			'</tr>'
		).join('');
		body.querySelectorAll('.edit-link').forEach((el) => {
			el.addEventListener('click', () => send('editEntry', { id: Number(el.getAttribute('data-id')) }));
		});
	}

	function renderTotals(totals, grandTotalLabel) {
		document.getElementById('totalsBody').innerHTML = totals.map((t) =>
			'<tr><td>' + escapeHtml(t.projectName) + '</td><td>' + t.totalLabel + '</td></tr>'
		).join('');
		document.getElementById('grandTotal').textContent = grandTotalLabel;
	}

	window.addEventListener('message', (event) => {
		const message = event.data;
		if (message.type === 'state') {
			renderActive(message.state.active);
			renderEntries(message.state.entries);
			renderTotals(message.state.totals, message.state.grandTotalLabel);
		}
	});

	send('refresh');
</script>
</body>
</html>`;
}

export function showDashboard(context: vscode.ExtensionContext): void {
	if (panel) {
		panel.reveal();
		postState(context);
		return;
	}

	panel = vscode.window.createWebviewPanel('dailydevDashboard', 'DailyDev Tracker', vscode.ViewColumn.One, {
		enableScripts: true,
		retainContextWhenHidden: true
	});
	panel.webview.html = getHtml();

	panel.onDidDispose(() => {
		panel = undefined;
		stopTicking();
	});

	panel.onDidChangeViewState(() => {
		if (panel?.visible) {
			startTicking(context);
			postState(context);
		} else {
			stopTicking();
		}
	});

	panel.webview.onDidReceiveMessage(async (message: { type: string; id?: number }) => {
		switch (message.type) {
			case 'refresh':
				postState(context);
				return;
			case 'start':
				await vscode.commands.executeCommand('dailydev-tracker.startTask');
				break;
			case 'pause':
				await vscode.commands.executeCommand('dailydev-tracker.pauseTask');
				break;
			case 'resume':
				await vscode.commands.executeCommand('dailydev-tracker.resumeTask');
				break;
			case 'stop':
				await vscode.commands.executeCommand('dailydev-tracker.stopTask');
				break;
			case 'switch':
				await vscode.commands.executeCommand('dailydev-tracker.switchTask');
				break;
			case 'editEntry':
				if (message.id !== undefined) {
					await editEntry(message.id);
				}
				break;
			case 'addEntry':
				await addMissingEntry();
				break;
		}
		postState(context);
	});

	startTicking(context);
	postState(context);
}

export function dispose(): void {
	stopTicking();
	panel?.dispose();
	panel = undefined;
}
