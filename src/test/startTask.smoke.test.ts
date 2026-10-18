import * as assert from 'assert';
import * as vscode from 'vscode';

suite('startTask command smoke test', () => {
	test('adds a project, then starts a task against it and shows both in an info message', async () => {
		const extension = vscode.extensions.getExtension('undefined_publisher.dailydev-tracker');
		assert.ok(extension, 'extension should be discoverable by id');
		await extension!.activate();

		const originalShowInputBox = vscode.window.showInputBox;
		const originalShowQuickPick = vscode.window.showQuickPick;
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

			// Step 1: add a project via the "DailyDev: Add Project" command.
			(vscode.window as any).showInputBox = async () => projectName;
			await vscode.commands.executeCommand('dailydev-tracker.addProject');

			// Step 2: start a task, picking the project just created from the QuickPick.
			(vscode.window as any).showQuickPick = async (itemsOrPromise: any) => {
				const items = await itemsOrPromise;
				return items.find((item: any) => item.label === projectName);
			};
			(vscode.window as any).showInputBox = async () => 'Fix Delivery Tracker report';
			(vscode.window as any).showInformationMessage = async (message: string) => {
				capturedMessage = message;
				return undefined;
			};

			await vscode.commands.executeCommand('dailydev-tracker.startTask');

			// Leave no active session behind for the next test/run (use a no-op stub so this
			// doesn't clobber the captured "Started: ..." message above).
			(vscode.window as any).showInformationMessage = async () => undefined;
			await vscode.commands.executeCommand('dailydev-tracker.stopTask');
		} finally {
			(vscode.window as any).showInputBox = originalShowInputBox;
			(vscode.window as any).showQuickPick = originalShowQuickPick;
			(vscode.window as any).showInformationMessage = originalShowInformationMessage;
			(vscode.window as any).showWarningMessage = originalShowWarningMessage;
		}

		assert.ok(capturedMessage, 'expected an information message to be shown');
		assert.match(capturedMessage!, new RegExp(projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
		assert.match(capturedMessage!, /Fix Delivery Tracker report/);
	});
});
