import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import * as db from './db';
import * as session from './session';
import { pickTaskTarget, promptForTaskDescription } from './taskPicker';
import { promptForDurationMinutes, promptForDescriptionEdit } from './prompts';
import { formatDuration } from './time';
import { formatIstDateIso, formatIstDateLong, formatIstTime12h, fromIstComponents, toIstCalendar } from './istTime';

let panel: vscode.WebviewPanel | undefined;
let tickInterval: ReturnType<typeof setInterval> | undefined;
let statusBarButton: vscode.StatusBarItem | undefined;
/** Days back from today the dashboard is currently showing; 0 = today. Resets when the panel is reopened. */
let viewedDayOffset = 0;

export function activateStatusBarButton(context: vscode.ExtensionContext): void {
	statusBarButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
	statusBarButton.text = '$(graph) Dashboard';
	statusBarButton.tooltip = 'Open DailyDev Tracker dashboard';
	statusBarButton.command = 'dailydev-tracker.showDashboard';
	statusBarButton.show();
	context.subscriptions.push(statusBarButton);
}

export interface DashboardEntry {
	id: number;
	projectName: string;
	description: string;
	startLabel: string;
	endLabel: string;
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

export interface DashboardState {
	active: ActiveInfo | null;
	entries: DashboardEntry[];
	totals: ProjectTotal[];
	grandTotalLabel: string;
	dateLabel: string;
	isToday: boolean;
	canGoForward: boolean;
}

function getDayBounds(offsetDays: number): { startIso: string; endIso: string; dayStart: Date } {
	const cal = toIstCalendar(new Date());
	const start = fromIstComponents(cal.getUTCFullYear(), cal.getUTCMonth(), cal.getUTCDate() - offsetDays, 0, 0, 0);
	const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
	return { startIso: start.toISOString(), endIso: end.toISOString(), dayStart: start };
}

function buildState(context: vscode.ExtensionContext): DashboardState {
	const isToday = viewedDayOffset === 0;

	const activeSession = isToday ? session.getSession(context) : undefined;
	const active: ActiveInfo | null = activeSession
		? {
				label: activeSession.label,
				description: activeSession.description,
				elapsedLabel: formatDuration(session.computeElapsedMs(activeSession)),
				paused: !!activeSession.pausedAt
			}
		: null;

	const { startIso, endIso, dayStart } = getDayBounds(viewedDayOffset);
	const logs = db.listFinishedWorkLogsBetween(startIso, endIso);

	const entries: DashboardEntry[] = logs.map((log) => ({
		id: log.id,
		projectName: log.projectName,
		description: log.description,
		startLabel: formatIstTime12h(new Date(log.startTime)),
		endLabel: log.endTime ? formatIstTime12h(new Date(log.endTime)) : '—',
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

	return {
		active,
		entries,
		totals,
		grandTotalLabel: formatDuration(grandTotalSeconds * 1000),
		dateLabel: isToday ? `Today — ${formatIstDateLong(dayStart)}` : formatIstDateLong(dayStart),
		isToday,
		canGoForward: viewedDayOffset > 0
	};
}

export function buildSummaryText(state: DashboardState): string {
	const lines: string[] = [`DailyDev Tracker — ${state.dateLabel}`, ''];

	const byProject = new Map<string, DashboardEntry[]>();
	for (const entry of state.entries) {
		const list = byProject.get(entry.projectName) ?? [];
		list.push(entry);
		byProject.set(entry.projectName, list);
	}

	if (byProject.size === 0) {
		lines.push('No tracked entries.');
	} else {
		for (const [projectName, entries] of byProject) {
			lines.push(projectName);
			for (const entry of entries) {
				lines.push(`  ${entry.startLabel} - ${entry.endLabel}  ${entry.description}  (${entry.durationLabel})`);
			}
			const subtotal = entries.reduce((sum, e) => sum + e.durationSeconds, 0);
			lines.push(`  Subtotal: ${formatDuration(subtotal * 1000)}`);
			lines.push('');
		}
	}

	lines.push(`Total: ${state.grandTotalLabel}`);
	return lines.join('\n');
}

export function buildCsv(state: DashboardState, dateIso: string): string {
	const escape = (value: string): string => {
		if (/[",\n]/.test(value)) {
			return `"${value.replace(/"/g, '""')}"`;
		}
		return value;
	};
	const header = ['Date', 'Project', 'Task', 'Start', 'End', 'Duration'];
	const rows = state.entries.map((entry) => [
		dateIso,
		entry.projectName,
		entry.description,
		entry.startLabel,
		entry.endLabel,
		entry.durationLabel
	]);
	return [header, ...rows].map((row) => row.map(escape).join(',')).join('\n');
}

async function copySummary(context: vscode.ExtensionContext): Promise<void> {
	const state = buildState(context);
	await vscode.env.clipboard.writeText(buildSummaryText(state));
	vscode.window.showInformationMessage('Timesheet summary copied to clipboard.');
}

async function exportCsv(context: vscode.ExtensionContext): Promise<void> {
	const state = buildState(context);
	const { dayStart } = getDayBounds(viewedDayOffset);
	const dateIso = formatIstDateIso(dayStart);

	const uri = await vscode.window.showSaveDialog({
		defaultUri: vscode.Uri.file(path.join(os.homedir(), `dailydev-timesheet-${dateIso}.csv`)),
		filters: { 'CSV': ['csv'] }
	});
	if (!uri) {
		return;
	}

	await vscode.workspace.fs.writeFile(uri, Buffer.from(buildCsv(state, dateIso), 'utf8'));
	vscode.window.showInformationMessage(`Timesheet exported to ${uri.fsPath}`);
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
	if (viewedDayOffset !== 0) {
		return;
	}
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
		const minutes = await promptForDurationMinutes(
			`Corrected duration in minutes for "${log.description}"`,
			Math.round((log.durationSeconds ?? 0) / 60)
		);
		if (!minutes) {
			return;
		}
		db.updateWorkLogDuration(id, minutes * 60);
	} else {
		const newDescription = await promptForDescriptionEdit(log.description);
		if (!newDescription) {
			return;
		}
		db.updateWorkLogDescription(id, newDescription);
	}
}

async function addMissingEntry(): Promise<void> {
	if (viewedDayOffset !== 0) {
		return;
	}
	const target = await pickTaskTarget();
	if (!target) {
		return;
	}
	const description = await promptForTaskDescription();
	if (!description) {
		return;
	}
	const minutes = await promptForDurationMinutes('How many minutes did you spend on this?', 30);
	if (!minutes) {
		return;
	}
	const durationSeconds = minutes * 60;
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
	vscode.window.showInformationMessage(`Added: ${target.label} — ${description} (${minutes} min)`);
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
	.toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
	button:disabled { opacity: 0.5; cursor: default; }
</style>
</head>
<body>
	<div class="section-header">
		<h2 id="dateLabel"></h2>
		<div class="toolbar">
			<button id="prevDayBtn" class="secondary">◀ Prev day</button>
			<button id="todayBtn" class="secondary">Today</button>
			<button id="nextDayBtn" class="secondary">Next day ▶</button>
			<button id="copySummaryBtn" class="secondary">Copy Summary</button>
			<button id="exportCsvBtn" class="secondary">Export CSV</button>
			<button id="addEntryBtn">+ Add forgotten entry</button>
		</div>
	</div>

	<div id="activeCard" class="active-card idle">
		<div class="muted">No active task</div>
		<div class="buttons"><button id="startBtn">Start Task</button></div>
	</div>

	<table id="entriesTable">
		<thead><tr><th>Project</th><th>Task</th><th>Start</th><th>End</th><th>Duration</th><th></th></tr></thead>
		<tbody id="entriesBody"><tr><td colspan="6" class="muted">No entries yet today.</td></tr></tbody>
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
	document.getElementById('prevDayBtn').addEventListener('click', () => send('prevDay'));
	document.getElementById('nextDayBtn').addEventListener('click', () => send('nextDay'));
	document.getElementById('todayBtn').addEventListener('click', () => send('today'));
	document.getElementById('copySummaryBtn').addEventListener('click', () => send('copySummary'));
	document.getElementById('exportCsvBtn').addEventListener('click', () => send('exportCsv'));

	function renderActive(active, isToday) {
		const card = document.getElementById('activeCard');
		if (!active) {
			card.classList.add('idle');
			card.innerHTML = isToday
				? '<div class="muted">No active task</div><div class="buttons"><button id="startBtn">Start Task</button></div>'
				: '<div class="muted">Viewing a past day</div>';
			const startBtn = document.getElementById('startBtn');
			if (startBtn) { startBtn.addEventListener('click', () => send('start')); }
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

	function renderEntries(entries, isToday) {
		const body = document.getElementById('entriesBody');
		if (!entries.length) {
			body.innerHTML = '<tr><td colspan="6" class="muted">No entries for this day.</td></tr>';
			return;
		}
		body.innerHTML = entries.map((e) =>
			'<tr>' +
				'<td>' + escapeHtml(e.projectName) + '</td>' +
				'<td>' + escapeHtml(e.description) + '</td>' +
				'<td>' + e.startLabel + '</td>' +
				'<td>' + e.endLabel + '</td>' +
				'<td>' + e.durationLabel + '</td>' +
				'<td>' + (isToday ? '<span class="edit-link" data-id="' + e.id + '">Edit</span>' : '') + '</td>' +
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
			const state = message.state;
			document.getElementById('dateLabel').textContent = state.dateLabel;
			document.getElementById('nextDayBtn').disabled = !state.canGoForward;
			document.getElementById('todayBtn').disabled = state.isToday;
			document.getElementById('addEntryBtn').disabled = !state.isToday;
			renderActive(state.active, state.isToday);
			renderEntries(state.entries, state.isToday);
			renderTotals(state.totals, state.grandTotalLabel);
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

	viewedDayOffset = 0;
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
			case 'prevDay':
				viewedDayOffset += 1;
				break;
			case 'nextDay':
				if (viewedDayOffset > 0) {
					viewedDayOffset -= 1;
				}
				break;
			case 'today':
				viewedDayOffset = 0;
				break;
			case 'copySummary':
				await copySummary(context);
				break;
			case 'exportCsv':
				await exportCsv(context);
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
