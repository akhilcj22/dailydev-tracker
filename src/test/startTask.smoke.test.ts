import * as assert from 'assert';
import * as vscode from 'vscode';
import { stubStartTaskModal } from './testUtils';

suite('startTask command smoke test', () => {
	test('starts a task against a newly created project and shows both in an info message', async () => {
		const extension = vscode.extensions.getExtension('undefined_publisher.dailydev-tracker');
		assert.ok(extension, 'extension should be discoverable by id');
		await extension!.activate();

		const originalShowInformationMessage = vscode.window.showInformationMessage;
		const originalShowWarningMessage = vscode.window.showWarningMessage;

		let capturedMessage: string | undefined;

		// globalStorage (and the SQLite file in it) persists across test runs in this
		// environment's test profile, so a fixed project name would collide with a
		// previous run's data. A unique name per run keeps the test independent of that state.
		const projectName = `Smoke Test Project ${Date.now()}`;

		try {
			// A session left active by a previous run (globalState persists the same way
			// the SQLite file does) would otherwise make startTask prompt to switch instead
			// of starting fresh.
			(vscode.window as any).showWarningMessage = async () => undefined;
			await vscode.commands.executeCommand('dailydev-tracker.stopTask');

			(vscode.window as any).showInformationMessage = async (message: string) => {
				capturedMessage = message;
				return undefined;
			};

			// The combined "Start Task" modal lets you pick/add a project and type the task
			// description in one popup; submit it with the "+ Add new project..." option.
			const restoreModal = stubStartTaskModal(() => ({
				projectValue: 'add-new',
				newProjectName: projectName,
				description: 'Fix Delivery Tracker report'
			}));
			await vscode.commands.executeCommand('dailydev-tracker.startTask');
			restoreModal();

			// Leave no active session behind for the next test/run (use a no-op stub so this
			// doesn't clobber the captured "Started: ..." message above).
			(vscode.window as any).showInformationMessage = async () => undefined;
			await vscode.commands.executeCommand('dailydev-tracker.stopTask');
		} finally {
			(vscode.window as any).showInformationMessage = originalShowInformationMessage;
			(vscode.window as any).showWarningMessage = originalShowWarningMessage;
		}

		assert.ok(capturedMessage, 'expected an information message to be shown');
		assert.match(capturedMessage!, new RegExp(projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
		assert.match(capturedMessage!, /Fix Delivery Tracker report/);
	});
});
