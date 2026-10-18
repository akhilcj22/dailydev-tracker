import * as assert from 'assert';
import * as vscode from 'vscode';
import { computeElapsedMs } from '../session';
import { ActiveSession } from '../models';
import { stubModalInput } from './testUtils';

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
			const extension = vscode.extensions.getExtension('undefined_publisher.dailydev-tracker');
			assert.ok(extension, 'extension should be discoverable by id');
			await extension!.activate();
			return extension!;
		}

		test('start, pause, resume, then stop records a finished entry and rejects a second stop', async () => {
			await getExtension();

			const originalShowQuickPick = vscode.window.showQuickPick;
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

				let restoreModal = stubModalInput(projectName);
				await vscode.commands.executeCommand('dailydev-tracker.addProject');
				restoreModal();

				(vscode.window as any).showQuickPick = async (itemsOrPromise: any) => {
					const items = await itemsOrPromise;
					return items.find((item: any) => item.label === projectName);
				};
				(vscode.window as any).showInformationMessage = async (message: string) => {
					infoMessages.push(message);
					return undefined;
				};

				restoreModal = stubModalInput('Pause/resume task');
				await vscode.commands.executeCommand('dailydev-tracker.startTask');
				restoreModal();

				await vscode.commands.executeCommand('dailydev-tracker.pauseTask');
				await vscode.commands.executeCommand('dailydev-tracker.resumeTask');
				await vscode.commands.executeCommand('dailydev-tracker.stopTask');
				await vscode.commands.executeCommand('dailydev-tracker.stopTask');
			} finally {
				(vscode.window as any).showQuickPick = originalShowQuickPick;
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

		test('switching tasks stops the first entry and starts the next one', async () => {
			await getExtension();

			const originalShowQuickPick = vscode.window.showQuickPick;
			const originalShowInformationMessage = vscode.window.showInformationMessage;
			const originalShowWarningMessage = vscode.window.showWarningMessage;

			const infoMessages: string[] = [];
			const projectA = `Smoke Switch A ${Date.now()}`;
			const projectB = `Smoke Switch B ${Date.now()}`;

			try {
				(vscode.window as any).showWarningMessage = async () => undefined;
				await vscode.commands.executeCommand('dailydev-tracker.stopTask');

				let restoreModal = stubModalInput(projectA);
				await vscode.commands.executeCommand('dailydev-tracker.addProject');
				restoreModal();

				restoreModal = stubModalInput(projectB);
				await vscode.commands.executeCommand('dailydev-tracker.addProject');
				restoreModal();

				(vscode.window as any).showInformationMessage = async (message: string) => {
					infoMessages.push(message);
					return undefined;
				};

				(vscode.window as any).showQuickPick = async (itemsOrPromise: any) => {
					const items = await itemsOrPromise;
					return items.find((item: any) => item.label === projectA);
				};
				restoreModal = stubModalInput('Task on A');
				await vscode.commands.executeCommand('dailydev-tracker.startTask');
				restoreModal();

				(vscode.window as any).showQuickPick = async (itemsOrPromise: any) => {
					const items = await itemsOrPromise;
					return items.find((item: any) => item.label === projectB);
				};
				restoreModal = stubModalInput('Task on B');
				await vscode.commands.executeCommand('dailydev-tracker.switchTask');
				restoreModal();

				// Clean up so this doesn't leak into later runs.
				(vscode.window as any).showInformationMessage = async () => undefined;
				await vscode.commands.executeCommand('dailydev-tracker.stopTask');
			} finally {
				(vscode.window as any).showQuickPick = originalShowQuickPick;
				(vscode.window as any).showInformationMessage = originalShowInformationMessage;
				(vscode.window as any).showWarningMessage = originalShowWarningMessage;
			}

			assert.ok(infoMessages.some((m) => m.startsWith('Started:') && m.includes(projectA) && m.includes('Task on A')));
			assert.ok(infoMessages.some((m) => m.startsWith('Stopped:') && m.includes(projectA) && m.includes('Task on A')));
			assert.ok(infoMessages.some((m) => m.startsWith('Started:') && m.includes(projectB) && m.includes('Task on B')));
		});
	});
});
