import * as vscode from 'vscode';
import * as db from './db';
import { Project } from './models';
import { TaskTarget } from './session';

export interface StartTaskResult {
	target: TaskTarget;
	description: string;
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function getNonce(): string {
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let text = '';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}

const RECENT_TASKS_LIMIT = 3;

function buildRecentTasksByProject(projects: Project[]): Record<string, string[]> {
	const recent: Record<string, string[]> = {};
	for (const project of projects) {
		recent[`p:${project.id}`] = db.listRecentDescriptions(project.id, RECENT_TASKS_LIMIT);
	}
	recent['client-support'] = db.listRecentDescriptions(null, RECENT_TASKS_LIMIT);
	return recent;
}

function getHtml(projects: Project[]): string {
	const nonce = getNonce();
	const projectOptions = projects.map((p) => `<option value="p:${p.id}">${escapeHtml(p.name)}</option>`).join('');
	const recentTasksByProject = buildRecentTasksByProject(projects);

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Start Task</title>
<style>
	html, body { height: 100%; margin: 0; }
	body {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--vscode-editor-background);
		font-family: var(--vscode-font-family);
		color: var(--vscode-foreground);
	}
	.modal-card {
		background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
		border: 1px solid var(--vscode-widget-border, #444);
		border-radius: 8px;
		padding: 20px 24px;
		width: 380px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}
	.modal-card h3 { margin: 0 0 16px 0; font-size: 15px; font-weight: 600; }
	label { display: block; font-size: 12px; color: var(--vscode-descriptionForeground); margin: 12px 0 4px; }
	label:first-of-type { margin-top: 0; }
	select, input[type="text"] {
		width: 100%;
		box-sizing: border-box;
		padding: 6px 8px;
		background: var(--vscode-input-background);
		color: var(--vscode-input-foreground);
		border: 1px solid var(--vscode-input-border, transparent);
		border-radius: 3px;
		font-size: 13px;
		font-family: var(--vscode-font-family);
	}
	select:focus, input[type="text"]:focus { outline: 1px solid var(--vscode-focusBorder); }
	.error { color: var(--vscode-errorForeground, #f14c4c); font-size: 12px; min-height: 16px; margin-top: 4px; }
	.hidden { display: none; }
	.recent-label { font-size: 11px; color: var(--vscode-descriptionForeground); margin: 6px 0 4px; }
	.recent-tasks { display: flex; flex-wrap: wrap; gap: 6px; }
	.chip {
		background: var(--vscode-badge-background, var(--vscode-button-secondaryBackground));
		color: var(--vscode-badge-foreground, var(--vscode-button-secondaryForeground));
		border: none;
		padding: 3px 10px;
		border-radius: 12px;
		font-size: 12px;
		cursor: pointer;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chip:hover { opacity: 0.85; }
	.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
	button {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
		border: none;
		padding: 6px 14px;
		border-radius: 3px;
		cursor: pointer;
		font-family: var(--vscode-font-family);
	}
	button:hover { background: var(--vscode-button-hoverBackground); }
	button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
</style>
</head>
<body>
	<div class="modal-card">
		<h3>Start Task</h3>

		<label for="project">Which project are you working on?</label>
		<select id="project">
			${projectOptions}
			<option value="client-support">Client Support (debugging / troubleshooting)</option>
			<option value="add-new">+ Add new project...</option>
		</select>

		<div id="newProjectRow" class="hidden">
			<label for="newProjectName">New project name</label>
			<input id="newProjectName" type="text" placeholder="ERPNext / Grain N Grace" />
			<div class="error" id="newProjectError"></div>
		</div>

		<label for="description">What task are you going to work on?</label>
		<input id="description" type="text" placeholder="Fix Delivery Tracker report" />
		<div class="error" id="descriptionError"></div>
		<div id="recentTasks" class="hidden"></div>

		<div class="actions">
			<button class="secondary" id="cancelBtn">Cancel</button>
			<button id="okBtn">Start</button>
		</div>
	</div>
<script nonce="${nonce}">
	const vscode = acquireVsCodeApi();
	const projectSelect = document.getElementById('project');
	const newProjectRow = document.getElementById('newProjectRow');
	const newProjectName = document.getElementById('newProjectName');
	const newProjectError = document.getElementById('newProjectError');
	const description = document.getElementById('description');
	const descriptionError = document.getElementById('descriptionError');
	const recentTasks = document.getElementById('recentTasks');
	const recentTasksByProject = ${JSON.stringify(recentTasksByProject).replace(/</g, '\\u003c')};

	function escapeHtml(s) {
		return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
	}

	function renderRecentTasks() {
		const items = recentTasksByProject[projectSelect.value] || [];
		if (!items.length) {
			recentTasks.classList.add('hidden');
			recentTasks.innerHTML = '';
			return;
		}
		recentTasks.classList.remove('hidden');
		recentTasks.innerHTML =
			'<div class="recent-label">Recent tasks for this project</div>' +
			'<div class="recent-tasks">' +
			items.map((desc) => '<button type="button" class="chip" data-desc="' + escapeHtml(desc) + '">' + escapeHtml(desc) + '</button>').join('') +
			'</div>';
		recentTasks.querySelectorAll('.chip').forEach((chip) => {
			chip.addEventListener('click', () => {
				description.value = chip.getAttribute('data-desc');
				description.focus();
			});
		});
	}

	function updateNewProjectVisibility() {
		newProjectRow.classList.toggle('hidden', projectSelect.value !== 'add-new');
	}
	projectSelect.addEventListener('change', () => {
		updateNewProjectVisibility();
		renderRecentTasks();
	});
	updateNewProjectVisibility();
	renderRecentTasks();

	function currentState() {
		return {
			projectValue: projectSelect.value,
			newProjectName: newProjectName.value,
			description: description.value
		};
	}

	function submit() { vscode.postMessage(Object.assign({ type: 'submit' }, currentState())); }
	function cancel() { vscode.postMessage({ type: 'cancel' }); }

	[newProjectName, description].forEach((el) => {
		el.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { submit(); }
			else if (e.key === 'Escape') { cancel(); }
		});
	});
	document.getElementById('okBtn').addEventListener('click', submit);
	document.getElementById('cancelBtn').addEventListener('click', cancel);

	window.addEventListener('message', (event) => {
		const msg = event.data;
		if (msg.type === 'validation') {
			newProjectError.textContent = msg.newProjectError || '';
			descriptionError.textContent = msg.descriptionError || '';
		}
	});

	description.focus();
</script>
</body>
</html>`;
}

function validate(
	projects: Project[],
	projectValue: string,
	newProjectNameValue: string,
	descriptionValue: string
): { newProjectError?: string; descriptionError?: string } {
	const errors: { newProjectError?: string; descriptionError?: string } = {};

	if (projectValue === 'add-new') {
		const name = newProjectNameValue.trim();
		if (!name) {
			errors.newProjectError = 'Project name cannot be empty';
		} else if (db.findProjectByName(name)) {
			errors.newProjectError = 'A project with this name already exists';
		}
	}

	if (!descriptionValue.trim()) {
		errors.descriptionError = 'Task description cannot be empty';
	}

	return errors;
}

function resolveTarget(projects: Project[], projectValue: string, newProjectNameValue: string): TaskTarget | undefined {
	if (projectValue === 'client-support') {
		return { projectId: null, category: 'client-support', label: '$(law) Client Support' };
	}
	if (projectValue === 'add-new') {
		const project = db.addProject(newProjectNameValue.trim());
		return { projectId: project.id, category: 'project', label: project.name };
	}
	if (projectValue.startsWith('p:')) {
		const id = Number(projectValue.slice(2));
		const project = projects.find((p) => p.id === id);
		if (project) {
			return { projectId: project.id, category: 'project', label: project.name };
		}
	}
	return undefined;
}

export function showStartTaskModal(): Promise<StartTaskResult | undefined> {
	return new Promise((resolve) => {
		const projects = db.listProjects();
		const panel = vscode.window.createWebviewPanel('dailydevStartTask', 'Start Task', vscode.ViewColumn.Active, {
			enableScripts: true
		});

		let resolved = false;
		const finish = (value: StartTaskResult | undefined) => {
			if (resolved) {
				return;
			}
			resolved = true;
			resolve(value);
			panel.dispose();
		};

		panel.webview.html = getHtml(projects);

		panel.webview.onDidReceiveMessage(
			(message: { type: string; projectValue?: string; newProjectName?: string; description?: string }) => {
				if (message.type === 'cancel') {
					finish(undefined);
					return;
				}
				if (message.type !== 'submit') {
					return;
				}
				const projectValue = message.projectValue ?? '';
				const newProjectNameValue = message.newProjectName ?? '';
				const descriptionValue = message.description ?? '';

				const errors = validate(projects, projectValue, newProjectNameValue, descriptionValue);
				if (errors.newProjectError || errors.descriptionError) {
					panel.webview.postMessage({ type: 'validation', ...errors });
					return;
				}

				const target = resolveTarget(projects, projectValue, newProjectNameValue);
				if (!target) {
					return;
				}
				finish({ target, description: descriptionValue.trim() });
			}
		);

		panel.onDidDispose(() => finish(undefined));
	});
}
