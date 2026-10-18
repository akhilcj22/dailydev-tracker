import * as vscode from 'vscode';
import * as db from './db';
import { Project } from './models';

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

async function pickTaskTarget(): Promise<{ projectId: number | null; category: 'project' | 'client-support'; label: string } | undefined> {
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

export async function activate(context: vscode.ExtensionContext) {
	await db.init(context);
	console.log('DailyDev Tracker is active!');

	const addProjectCommand = vscode.commands.registerCommand('dailydev-tracker.addProject', async () => {
		const name = await promptForProjectName();
		if (!name) {
			return;
		}
		db.addProject(name);
		vscode.window.showInformationMessage(`Project "${name}" added.`);
	});

	const startTaskCommand = vscode.commands.registerCommand('dailydev-tracker.startTask', async () => {
		const target = await pickTaskTarget();
		if (!target) {
			return;
		}

		const task = await vscode.window.showInputBox({
			prompt: 'What task are you going to work on?',
			placeHolder: 'Fix Delivery Tracker report',
			validateInput: (value) => (value.trim() ? undefined : 'Task description cannot be empty')
		});

		if (!task?.trim()) {
			return;
		}

		db.addWorkLog({
			projectId: target.projectId,
			category: target.category,
			description: task.trim(),
			startTime: new Date().toISOString()
		});

		vscode.window.showInformationMessage(`Project: ${target.label}\nTask: ${task.trim()}`);
	});

	context.subscriptions.push(addProjectCommand, startTaskCommand);
}

export function deactivate() {}
