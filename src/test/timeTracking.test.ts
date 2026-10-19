import * as assert from 'assert';
import * as vscode from 'vscode';
import { computeElapsedMs } from '../session';
import { ActiveSession } from '../models';
import { formatIstTime24h } from '../istTime';
import { stubStartTaskModal, stubModalInput, findProjectOptionValue } from './testUtils';

suite('time tracking', () => {
	test('computeElapsedMs excludes time spent paused', () => {
		const start = Date.UTC(2026, 0, 1, 9, 0, 0);
		const session: ActiveSession = {
			workLogId: 1,
			projectId: 1,
			category: 'project',
			label: 'ERPNext',
			description: 'Test',
			startTime: new Date(start).toISOString(),
			accumulatedPauseMs: 0,
			pausedAt: null
		};

		// Ran for 10s, then paused.
		const pausedAt = start + 10_000;
		const pausedSession: ActiveSession = { ...session, pausedAt: new Date(pausedAt).toISOString() };
		assert.strictEqual(computeElapsedMs(pausedSession, pausedAt + 999_999), 10_000, 'elapsed time must freeze while paused, regardless of reference time');

		// Resumed after a 5s pause, then ran for another 5s.
		const resumedSession: ActiveSession = { ...session, accumulatedPauseMs: 5_000, pausedAt: null };
		const referenceAfterResume = start + 10_000 + 5_000 + 5_000;
		assert.strictEqual(computeElapsedMs(resumedSession, referenceAfterResume), 15_000, 'elapsed time must resume counting from where it left off, excluding the paused gap');
	});

	suite('command flow', () => {
		async function getExtension(): Promise<vscode.Extension<unknown>> {
			const extension = vscode.extensions.getExtension('akhilcj22.dailydev-tracker');
			assert.ok(extension, 'extension should be discoverable by id');
			await extension!.activate();
			return extension!;
		}

		test('start, pause, resume, then stop records a finished entry and rejects a second stop', async () => {
			await getExtension();

			const originalShowInformationMessage = vscode.window.showInformationMessage;
			const originalShowWarningMessage = vscode.window.showWarningMessage;

			const infoMessages: string[] = [];
			const warningMessages: string[] = [];
			const projectName = `Smoke Pause Project ${Date.now()}`;

			try {
				(vscode.window as any).showWarningMessage = async (message: string) => {
					warningMessages.push(message);
					return undefined;
				};
				// Clear any session left dangling by a previous run before starting fresh.
				await vscode.commands.executeCommand('dailydev-tracker.stopTask');
				warningMessages.length = 0;

				(vscode.window as any).showInformationMessage = async (message: string) => {
					infoMessages.push(message);
					return undefined;
				};

				const restoreModal = stubStartTaskModal(() => ({
					projectValue: 'add-new',
					newProjectName: projectName,
					description: 'Pause/resume task'
				}));
				await vscode.commands.executeCommand('dailydev-tracker.startTask');
				restoreModal();

				await vscode.commands.executeCommand('dailydev-tracker.pauseTask');
				await vscode.commands.executeCommand('dailydev-tracker.resumeTask');
				await vscode.commands.executeCommand('dailydev-tracker.stopTask');
				await vscode.commands.executeCommand('dailydev-tracker.stopTask');
			} finally {
				(vscode.window as any).showInformationMessage = originalShowInformationMessage;
				(vscode.window as any).showWarningMessage = originalShowWarningMessage;
			}

			assert.ok(infoMessages.some((m) => m.startsWith('Started:') && m.includes(projectName)), 'expected a Started message');
			assert.ok(infoMessages.some((m) => /^Task paused\.?$/.test(m)), 'expected a paused confirmation');
			assert.ok(infoMessages.some((m) => /^Task resumed\.?$/.test(m)), 'expected a resumed confirmation');
			assert.ok(
				infoMessages.some((m) => m.startsWith('Stopped:') && /\d{2}:\d{2}:\d{2}/.test(m)),
				'expected a Stopped message with a formatted duration'
			);
			assert.ok(
				warningMessages.some((m) => m.includes('No active task to stop')),
				'the second stopTask call should warn that nothing is active'
			);
		});

		test('switching tasks stops the first entry and starts the next one, picking an existing project', async () => {
			await getExtension();

			const originalShowInformationMessage = vscode.window.showInformationMessage;
			const originalShowWarningMessage = vscode.window.showWarningMessage;

			const infoMessages: string[] = [];
			const projectA = `Smoke Switch A ${Date.now()}`;
			const projectB = `Smoke Switch B ${Date.now()}`;

			try {
				(vscode.window as any).showWarningMessage = async () => undefined;
				await vscode.commands.executeCommand('dailydev-tracker.stopTask');

				(vscode.window as any).showInformationMessage = async (message: string) => {
					infoMessages.push(message);
					return undefined;
				};

				// Start on project A, creating it inline via the "+ Add new project..." option.
				let restoreModal = stubStartTaskModal(() => ({
					projectValue: 'add-new',
					newProjectName: projectA,
					description: 'Task on A'
				}));
				await vscode.commands.executeCommand('dailydev-tracker.startTask');
				restoreModal();

				// Create project B as a standalone project row (not starting a task on it yet)
				// via the plain "Add Project" command, so it already exists when we switch.
				const restoreAddProjectModal = stubModalInput(projectB);
				await vscode.commands.executeCommand('dailydev-tracker.addProject');
				restoreAddProjectModal();

				// Switch from A to B, picking B from the dropdown by name (real existing project).
				restoreModal = stubStartTaskModal((html) => {
					const projectBValue = findProjectOptionValue(html, projectB);
					return projectBValue ? { projectValue: projectBValue, description: 'Task on B' } : undefined;
				});
				await vscode.commands.executeCommand('dailydev-tracker.switchTask');
				restoreModal();

				// Clean up so this doesn't leak into later runs.
				(vscode.window as any).showInformationMessage = async () => undefined;
				await vscode.commands.executeCommand('dailydev-tracker.stopTask');
			} finally {
				(vscode.window as any).showInformationMessage = originalShowInformationMessage;
				(vscode.window as any).showWarningMessage = originalShowWarningMessage;
			}

			assert.ok(infoMessages.some((m) => m.startsWith('Started:') && m.includes(projectA) && m.includes('Task on A')));
			assert.ok(infoMessages.some((m) => m.startsWith('Stopped:') && m.includes(projectA) && m.includes('Task on A')));
			assert.ok(infoMessages.some((m) => m.startsWith('Started:') && m.includes(projectB) && m.includes('Task on B')));
		});

		test('backdating the start time in the popup produces a correspondingly longer duration', async () => {
			await getExtension();

			const originalShowInformationMessage = vscode.window.showInformationMessage;
			const originalShowWarningMessage = vscode.window.showWarningMessage;

			const infoMessages: string[] = [];
			const projectName = `Smoke Backdate Project ${Date.now()}`;

			try {
				(vscode.window as any).showWarningMessage = async () => undefined;
				await vscode.commands.executeCommand('dailydev-tracker.stopTask');

				(vscode.window as any).showInformationMessage = async (message: string) => {
					infoMessages.push(message);
					return undefined;
				};

				const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
				const backdatedTime = formatIstTime24h(tenMinutesAgo);

				const restoreModal = stubStartTaskModal(() => ({
					projectValue: 'add-new',
					newProjectName: projectName,
					description: 'Backdated task',
					startTime: backdatedTime
				}));
				await vscode.commands.executeCommand('dailydev-tracker.startTask');
				restoreModal();

				await vscode.commands.executeCommand('dailydev-tracker.stopTask');
			} finally {
				(vscode.window as any).showInformationMessage = originalShowInformationMessage;
				(vscode.window as any).showWarningMessage = originalShowWarningMessage;
			}

			const stoppedMessage = infoMessages.find((m) => m.startsWith('Stopped:') && m.includes(projectName));
			assert.ok(stoppedMessage, 'expected a Stopped message');
			const match = /(\d{2}):(\d{2}):(\d{2})/.exec(stoppedMessage!);
			assert.ok(match, 'expected a formatted HH:mm:ss duration');
			const totalSeconds = Number(match![1]) * 3600 + Number(match![2]) * 60 + Number(match![3]);
			// Allow a little slack for the HH:mm input's minute-level precision and test execution
			// time, but this must reflect the backdated start, not ~0s from "now".
			assert.ok(totalSeconds >= 9 * 60, `expected duration to reflect the backdated start time, got ${totalSeconds}s`);
		});
	});
});
