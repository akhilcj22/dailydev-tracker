import * as assert from 'assert';
import * as vscode from 'vscode';

suite('dashboard', () => {
	test('showDashboard renders without throwing, idle and with an active session', async () => {
		const extension = vscode.extensions.getExtension('undefined_publisher.dailydev-tracker');
		assert.ok(extension, 'extension should be discoverable by id');
		await extension!.activate();

		const originalShowInputBox = vscode.window.showInputBox;
		const originalShowQuickPick = vscode.window.showQuickPick;
		const originalShowInformationMessage = vscode.window.showInformationMessage;
		const originalShowWarningMessage = vscode.window.showWarningMessage;

		const projectName = `Dashboard Smoke ${Date.now()}`;

		try {
			(vscode.window as any).showWarningMessage = async () => undefined;
			(vscode.window as any).showInformationMessage = async () => undefined;
			await vscode.commands.executeCommand('dailydev-tracker.stopTask');

			// Idle dashboard (no active session).
			await vscode.commands.executeCommand('dailydev-tracker.showDashboard');

			// Dashboard with an active session.
			(vscode.window as any).showInputBox = async () => projectName;
			await vscode.commands.executeCommand('dailydev-tracker.addProject');
			(vscode.window as any).showQuickPick = async (itemsOrPromise: any) => {
				const items = await itemsOrPromise;
				return items.find((item: any) => item.label === projectName);
			};
			(vscode.window as any).showInputBox = async () => 'Dashboard task';
			await vscode.commands.executeCommand('dailydev-tracker.startTask');

			await vscode.commands.executeCommand('dailydev-tracker.showDashboard');

			await vscode.commands.executeCommand('dailydev-tracker.stopTask');

			// The now-finished entry should also render without throwing.
			await vscode.commands.executeCommand('dailydev-tracker.showDashboard');
		} finally {
			(vscode.window as any).showInputBox = originalShowInputBox;
			(vscode.window as any).showQuickPick = originalShowQuickPick;
			(vscode.window as any).showInformationMessage = originalShowInformationMessage;
			(vscode.window as any).showWarningMessage = originalShowWarningMessage;
		}
	});
});
