import * as assert from 'assert';
import * as vscode from 'vscode';
import { stubModalInput } from './testUtils';

suite('dashboard', () => {
	test('showDashboard renders without throwing, idle and with an active session', async () => {
		const extension = vscode.extensions.getExtension('undefined_publisher.dailydev-tracker');
		assert.ok(extension, 'extension should be discoverable by id');
		await extension!.activate();

		const originalShowQuickPick = vscode.window.showQuickPick;
		const originalShowInformationMessage = vscode.window.showInformationMessage;
		const originalShowWarningMessage = vscode.window.showWarningMessage;

		const projectName = `Dashboard Smoke ${Date.now()}`;

		try {
			(vscode.window as any).showWarningMessage = async () => undefined;
			(vscode.window as any).showInformationMessage = async () => undefined;
			await vscode.commands.executeCommand('dailydev-tracker.stopTask');

			// Idle dashboard (no active session). Not wrapped in a modal stub, since this is a
			// real dashboard panel and must go through the real createWebviewPanel.
			await vscode.commands.executeCommand('dailydev-tracker.showDashboard');

			// Dashboard with an active session.
			let restoreModal = stubModalInput(projectName);
			await vscode.commands.executeCommand('dailydev-tracker.addProject');
			restoreModal();

			(vscode.window as any).showQuickPick = async (itemsOrPromise: any) => {
				const items = await itemsOrPromise;
				return items.find((item: any) => item.label === projectName);
			};
			restoreModal = stubModalInput('Dashboard task');
			await vscode.commands.executeCommand('dailydev-tracker.startTask');
			restoreModal();

			await vscode.commands.executeCommand('dailydev-tracker.showDashboard');

			await vscode.commands.executeCommand('dailydev-tracker.stopTask');

			// The now-finished entry should also render without throwing.
			await vscode.commands.executeCommand('dailydev-tracker.showDashboard');
		} finally {
			(vscode.window as any).showQuickPick = originalShowQuickPick;
			(vscode.window as any).showInformationMessage = originalShowInformationMessage;
			(vscode.window as any).showWarningMessage = originalShowWarningMessage;
		}
	});
});
