import * as vscode from 'vscode';
import * as db from './db';
import { showModalInput } from './modal';
import { Project } from './models';
import { TaskTarget } from './session';

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

export async function promptForProjectName(): Promise<string | undefined> {
	const name = await showModalInput({
		title: 'Add Project',
		prompt: 'Project name',
		placeholder: 'ERPNext / Grain N Grace',
		validate: (value) => {
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

export async function promptForTaskDescription(promptText = 'What task are you going to work on?'): Promise<string | undefined> {
	const task = await showModalInput({
		title: 'Task Description',
		prompt: promptText,
		placeholder: 'Fix Delivery Tracker report',
		validate: (value) => (value.trim() ? undefined : 'Task description cannot be empty')
	});
	return task?.trim();
}

export async function pickTaskTarget(): Promise<TaskTarget | undefined> {
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
