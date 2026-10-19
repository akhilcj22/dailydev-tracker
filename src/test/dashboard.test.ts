import * as assert from 'assert';
import * as vscode from 'vscode';
import * as dashboard from '../dashboard';
import { stubGenericWebviewPanel, stubStartTaskModal } from './testUtils';

suite('dashboard', () => {
	// Must run before any other test in this file creates a real dashboard panel: showDashboard
	// reuses its module-level panel once created (across the whole extension-host process, not
	// just this test), so a stubbed createWebviewPanel only gets exercised while no panel exists yet.
	test('Phase 6: prev/next day navigation and Copy Summary reflect the viewed day', async () => {
		const extension = vscode.extensions.getExtension('undefined_publisher.dailydev-tracker');
		await extension!.activate();

		const originalShowInformationMessage = vscode.window.showInformationMessage;
		(vscode.window as any).showInformationMessage = async () => undefined;

		const originalClipboardText = await vscode.env.clipboard.readText();
		const fakePanel = stubGenericWebviewPanel();

		try {
			await vscode.commands.executeCommand('dailydev-tracker.showDashboard');

			const initialState = fakePanel.posted.at(-1)?.state as dashboard.DashboardState | undefined;
			assert.ok(initialState, 'dashboard should post an initial state');
			assert.strictEqual(initialState!.isToday, true);
			assert.strictEqual(initialState!.canGoForward, false);

			fakePanel.send({ type: 'prevDay' });
			const afterPrev = fakePanel.posted.at(-1)?.state as dashboard.DashboardState;
			assert.strictEqual(afterPrev.isToday, false, 'viewing yesterday should no longer be "today"');
			assert.strictEqual(afterPrev.canGoForward, true, 'should be able to step forward back to today');

			fakePanel.send({ type: 'nextDay' });
			const afterNext = fakePanel.posted.at(-1)?.state as dashboard.DashboardState;
			assert.strictEqual(afterNext.isToday, true, 'stepping forward from yesterday returns to today');

			fakePanel.send({ type: 'copySummary' });
			const clipboardText = await vscode.env.clipboard.readText();
			assert.ok(clipboardText.startsWith('DailyDev Tracker — '), 'Copy Summary should write a timesheet summary to the clipboard');
		} finally {
			fakePanel.restore();
			dashboard.dispose();
			(vscode.window as any).showInformationMessage = originalShowInformationMessage;
			await vscode.env.clipboard.writeText(originalClipboardText);
		}
	});

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
