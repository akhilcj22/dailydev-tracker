import * as vscode from 'vscode';
import * as db from './db';
import * as session from './session';
import { Project, WorkLogWithProjectName } from './models';
import { formatDuration } from './time';

interface AddProjectItem extends vscode.QuickPickItem {
	itemKind: 'add-project';
}

interface ClientSupportItem extends vscode.QuickPickItem {
	itemKind: 'client-support';
}

interface ProjectItem extends vscode.QuickPickItem {
	itemKind: 'project';
	project: Project;
}

type TaskTargetItem = AddProjectItem | ClientSupportItem | ProjectItem;

async function promptForProjectName(): Promise<string | undefined> {
	const name = await vscode.window.showInputBox({
		prompt: 'Project name',
		placeHolder: 'ERPNext / Grain N Grace',
		validateInput: (value) => {
			if (!value.trim()) {
				return 'Project name cannot be empty';
			}
			if (db.findProjectByName(value.trim())) {
				return 'A project with this name already exists';
			}
			return undefined;
		}
	});
	return name?.trim();
}

async function promptForTaskDescription(): Promise<string | undefined> {
	const task = await vscode.window.showInputBox({
		prompt: 'What task are you going to work on?',
		placeHolder: 'Fix Delivery Tracker report',
		validateInput: (value) => (value.trim() ? undefined : 'Task description cannot be empty')
	});
	return task?.trim();
}

async function pickTaskTarget(): Promise<session.TaskTarget | undefined> {
	const projects = db.listProjects();

	const items: TaskTargetItem[] = [
		...projects.map((project): ProjectItem => ({
			itemKind: 'project',
			project,
			label: project.name
		})),
		{
			itemKind: 'client-support',
			label: '$(law) Client Support',
			description: 'Debugging / troubleshooting'
		},
		{
			itemKind: 'add-project',
			label: '$(add) Add new project...'
		}
	];

	const picked = await vscode.window.showQuickPick(items, {
		placeHolder: 'Which project are you working on?'
	});

	if (!picked) {
		return undefined;
	}

	if (picked.itemKind === 'client-support') {
		return { projectId: null, category: 'client-support', label: picked.label };
	}

	if (picked.itemKind === 'project') {
		return { projectId: picked.project.id, category: 'project', label: picked.project.name };
	}

	const name = await promptForProjectName();
	if (!name) {
		return undefined;
	}
	const project = db.addProject(name);
	return { projectId: project.id, category: 'project', label: project.name };
}

async function startNewTaskFlow(context: vscode.ExtensionContext): Promise<void> {
	const target = await pickTaskTarget();
	if (!target) {
		return;
	}
	const description = await promptForTaskDescription();
	if (!description) {
		return;
	}
	await session.beginSession(context, target, description);
	vscode.window.showInformationMessage(`Started: ${target.label} — ${description}`);
}

async function switchTaskFlow(context: vscode.ExtensionContext): Promise<void> {
	const stopped = await session.stopSession(context);
	if (stopped) {
		vscode.window.showInformationMessage(
			`Stopped: ${stopped.label} — ${stopped.description} (${formatDuration(stopped.durationSeconds * 1000)})`
		);
	}
	await startNewTaskFlow(context);
}

function formatEntryTimeRange(entry: WorkLogWithProjectName): string {
	const start = new Date(entry.startTime).toLocaleString();
	const minutes = Math.round((entry.durationSeconds ?? 0) / 60);
	return `${start} — ${minutes} min`;
}

export async function activate(context: vscode.ExtensionContext) {
	await db.init(context);
	console.log('DailyDev Tracker is active!');
	session.restoreOnActivate(context);

	const addProjectCommand = vscode.commands.registerCommand('dailydev-tracker.addProject', async () => {
		const name = await promptForProjectName();
		if (!name) {
			return;
		}
		db.addProject(name);
		vscode.window.showInformationMessage(`Project "${name}" added.`);
	});

	const startTaskCommand = vscode.commands.registerCommand('dailydev-tracker.startTask', async () => {
		const current = session.getSession(context);
		if (current) {
			const choice = await vscode.window.showWarningMessage(
				`A task is already running: ${current.label} — ${current.description}. Switch to a new task instead?`,
				'Switch Task'
			);
			if (choice === 'Switch Task') {
				await switchTaskFlow(context);
			}
			return;
		}
		await startNewTaskFlow(context);
	});

	const switchTaskCommand = vscode.commands.registerCommand('dailydev-tracker.switchTask', async () => {
		await switchTaskFlow(context);
	});

	const pauseTaskCommand = vscode.commands.registerCommand('dailydev-tracker.pauseTask', async () => {
		const result = await session.pauseSession(context);
		if (result === 'none') {
			vscode.window.showWarningMessage('No active task to pause.');
		} else if (result === 'already-paused') {
			vscode.window.showInformationMessage('Task is already paused.');
		} else {
			vscode.window.showInformationMessage('Task paused.');
		}
	});

	const resumeTaskCommand = vscode.commands.registerCommand('dailydev-tracker.resumeTask', async () => {
		const result = await session.resumeSession(context);
		if (result === 'none') {
			vscode.window.showWarningMessage('No active task to resume.');
		} else if (result === 'not-paused') {
			vscode.window.showInformationMessage('Task is not paused.');
		} else {
			vscode.window.showInformationMessage('Task resumed.');
		}
	});

	const stopTaskCommand = vscode.commands.registerCommand('dailydev-tracker.stopTask', async () => {
		const result = await session.stopSession(context);
		if (!result) {
			vscode.window.showWarningMessage('No active task to stop.');
			return;
		}
		vscode.window.showInformationMessage(
			`Stopped: ${result.label} — ${result.description} (${formatDuration(result.durationSeconds * 1000)})`
		);
	});

	const showActiveTaskMenuCommand = vscode.commands.registerCommand('dailydev-tracker.showActiveTaskMenu', async () => {
		const current = session.getSession(context);
		if (!current) {
			vscode.window.showInformationMessage('No active task.');
			return;
		}
		const items: vscode.QuickPickItem[] = current.pausedAt
			? [{ label: '$(play) Resume' }, { label: '$(primitive-square) Stop' }]
			: [{ label: '$(debug-pause) Pause' }, { label: '$(primitive-square) Stop' }, { label: '$(arrow-swap) Switch Task' }];
		const picked = await vscode.window.showQuickPick(items, {
			placeHolder: `${current.label}: ${current.description}`
		});
		if (!picked) {
			return;
		}
		if (picked.label.includes('Resume')) {
			await vscode.commands.executeCommand('dailydev-tracker.resumeTask');
		} else if (picked.label.includes('Pause')) {
			await vscode.commands.executeCommand('dailydev-tracker.pauseTask');
		} else if (picked.label.includes('Stop')) {
			await vscode.commands.executeCommand('dailydev-tracker.stopTask');
		} else if (picked.label.includes('Switch')) {
			await switchTaskFlow(context);
		}
	});

	const editEntryDurationCommand = vscode.commands.registerCommand('dailydev-tracker.editEntryDuration', async () => {
		const entries = db.listFinishedWorkLogs(20);
		if (entries.length === 0) {
			vscode.window.showInformationMessage('No finished entries to edit yet.');
			return;
		}
		const items = entries.map((entry) => ({
			label: `${entry.projectName} — ${entry.description}`,
			description: formatEntryTimeRange(entry),
			entry
		}));
		const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select an entry to correct' });
		if (!picked) {
			return;
		}

		const minutesInput = await vscode.window.showInputBox({
			prompt: `Corrected duration in minutes for "${picked.entry.description}"`,
			value: String(Math.round((picked.entry.durationSeconds ?? 0) / 60)),
			validateInput: (value) =>
				/^\d+$/.test(value.trim()) && Number(value.trim()) > 0
					? undefined
					: 'Enter a whole number of minutes greater than 0'
		});
		if (!minutesInput) {
			return;
		}

		db.updateWorkLogDuration(picked.entry.id, Number(minutesInput.trim()) * 60);
		vscode.window.showInformationMessage('Duration updated.');
	});

	context.subscriptions.push(
		addProjectCommand,
		startTaskCommand,
		switchTaskCommand,
		pauseTaskCommand,
		resumeTaskCommand,
		stopTaskCommand,
		showActiveTaskMenuCommand,
		editEntryDurationCommand
	);
}

export function deactivate() {
	session.dispose();
}
