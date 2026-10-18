import * as assert from 'assert';
import * as vscode from 'vscode';
import { stubStartTaskModal } from './testUtils';

suite('dashboard', () => {
	test('showDashboard renders without throwing, idle and with an active session', async () => {
		const extension = vscode.extensions.getExtension('undefined_publisher.dailydev-tracker');
		assert.ok(extension, 'extension should be discoverable by id');
		await extension!.activate();

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
			const restoreModal = stubStartTaskModal(() => ({
				projectValue: 'add-new',
				newProjectName: projectName,
				description: 'Dashboard task'
			}));
			await vscode.commands.executeCommand('dailydev-tracker.startTask');
			restoreModal();

			await vscode.commands.executeCommand('dailydev-tracker.showDashboard');

			await vscode.commands.executeCommand('dailydev-tracker.stopTask');

			// The now-finished entry should also render without throwing.
			await vscode.commands.executeCommand('dailydev-tracker.showDashboard');
		} finally {
			(vscode.window as any).showInformationMessage = originalShowInformationMessage;
			(vscode.window as any).showWarningMessage = originalShowWarningMessage;
		}
	});
});
