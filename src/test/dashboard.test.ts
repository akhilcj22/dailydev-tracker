import * as assert from 'assert';
import * as vscode from 'vscode';
import * as dashboard from '../dashboard';
import { stubGenericWebviewPanel, stubStartTaskModal } from './testUtils';

function findEntryId(state: dashboard.DashboardState, description: string): number {
	const entry = state.entries.find((e) => e.description === description);
	assert.ok(entry, `expected an entry with description "${description}"`);
	return entry!.id;
}

suite('dashboard', () => {
	// Each test below stubs vscode.window.createWebviewPanel and must close that fake panel
	// before finishing: showDashboard() reuses its module-level panel once one exists, for the
	// whole extension-host process (not just the current test), so a later test's stub only gets
	// exercised once the previous panel is gone. Closing is done via the fake panel's own
	// closePanel() (firing the extension's real onDidDispose handler) rather than calling
	// dashboard.dispose() directly — the test file's `dashboard` import is a different module
	// instance than the one esbuild bundles into the running extension, so dispose() here would
	// reset the wrong copy's state and leave the live panel dangling.

	test('Phase 6: prev day navigation and returning to today reflect the viewed day', async () => {
		const extension = vscode.extensions.getExtension('akhilcj22.dailydev-tracker');
		await extension!.activate();

		const originalShowInformationMessage = vscode.window.showInformationMessage;
		(vscode.window as any).showInformationMessage = async () => undefined;

		const fakePanel = stubGenericWebviewPanel();

		try {
			await vscode.commands.executeCommand('dailydev-tracker.showDashboard');

			const initialState = fakePanel.posted.at(-1)?.state as dashboard.DashboardState | undefined;
			assert.ok(initialState, 'dashboard should post an initial state');
			assert.strictEqual(initialState!.isToday, true);

			fakePanel.send({ type: 'prevDay' });
			const afterPrev = fakePanel.posted.at(-1)?.state as dashboard.DashboardState;
			assert.strictEqual(afterPrev.isToday, false, 'viewing yesterday should no longer be "today"');

			fakePanel.send({ type: 'today' });
			const afterToday = fakePanel.posted.at(-1)?.state as dashboard.DashboardState;
			assert.strictEqual(afterToday.isToday, true, 'the Today button returns to today');
		} finally {
			fakePanel.closePanel();
			fakePanel.restore();
			(vscode.window as any).showInformationMessage = originalShowInformationMessage;
		}
	});

	test('showDashboard renders without throwing, idle and with an active session', async () => {
		const extension = vscode.extensions.getExtension('akhilcj22.dailydev-tracker');
		assert.ok(extension, 'extension should be discoverable by id');
		await extension!.activate();

		const originalShowInformationMessage = vscode.window.showInformationMessage;
		const originalShowWarningMessage = vscode.window.showWarningMessage;

		const projectName = `Dashboard Smoke ${Date.now()}`;
		const fakePanel = stubGenericWebviewPanel();

		try {
			(vscode.window as any).showWarningMessage = async () => undefined;
			(vscode.window as any).showInformationMessage = async () => undefined;
			await vscode.commands.executeCommand('dailydev-tracker.stopTask');

			// Idle dashboard (no active session).
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
			fakePanel.closePanel();
			fakePanel.restore();
			(vscode.window as any).showInformationMessage = originalShowInformationMessage;
			(vscode.window as any).showWarningMessage = originalShowWarningMessage;
		}
	});

	test("Resume starts a new session reusing a finished entry's project and description", async () => {
		const extension = vscode.extensions.getExtension('akhilcj22.dailydev-tracker');
		await extension!.activate();

		const originalShowInformationMessage = vscode.window.showInformationMessage;
		const originalShowWarningMessage = vscode.window.showWarningMessage;
		const infoMessages: string[] = [];

		const projectName = `Resume Smoke ${Date.now()}`;
		const description = 'Resumable task';

		try {
			(vscode.window as any).showWarningMessage = async () => undefined;
			(vscode.window as any).showInformationMessage = async (message: string) => {
				infoMessages.push(message);
				return undefined;
			};
			await vscode.commands.executeCommand('dailydev-tracker.stopTask');

			// Create a finished entry through the real start/stop commands, not db.addFinishedWorkLog
			// directly — this test file's `db` import is a different module instance than the one
			// esbuild bundles into the running extension, so writing through it would land in a
			// database the dashboard command never reads from.
			const restoreCreateModal = stubStartTaskModal(() => ({
				projectValue: 'add-new',
				newProjectName: projectName,
				description
			}));
			await vscode.commands.executeCommand('dailydev-tracker.startTask');
			restoreCreateModal();
			await vscode.commands.executeCommand('dailydev-tracker.stopTask');

			const fakePanel = stubGenericWebviewPanel();
			try {
				await vscode.commands.executeCommand('dailydev-tracker.showDashboard');

				const stateBeforeResume = fakePanel.posted.at(-1)?.state as dashboard.DashboardState;
				assert.strictEqual(stateBeforeResume.active, null, 'no task should be active yet');
				const id = findEntryId(stateBeforeResume, description);

				fakePanel.send({ type: 'resumeEntry', id });
				await new Promise((resolve) => setTimeout(resolve, 20));

				const stateAfterResume = fakePanel.posted.at(-1)?.state as dashboard.DashboardState;
				assert.ok(stateAfterResume.active, 'resuming should start a new active session');
				assert.strictEqual(stateAfterResume.active!.label, projectName);
				assert.strictEqual(stateAfterResume.active!.description, description);
				assert.ok(
					infoMessages.some((m) => m.includes('Resumed') && m.includes(description)),
					'should show a confirmation message naming the resumed task'
				);
			} finally {
				fakePanel.closePanel();
				fakePanel.restore();
				await vscode.commands.executeCommand('dailydev-tracker.stopTask');
			}
		} finally {
			(vscode.window as any).showInformationMessage = originalShowInformationMessage;
			(vscode.window as any).showWarningMessage = originalShowWarningMessage;
		}
	});

	test('Resume is refused while a task is already active', async () => {
		const extension = vscode.extensions.getExtension('akhilcj22.dailydev-tracker');
		await extension!.activate();

		const originalShowInformationMessage = vscode.window.showInformationMessage;
		const originalShowWarningMessage = vscode.window.showWarningMessage;
		const warnings: string[] = [];

		const activeProjectName = `Active Smoke ${Date.now()}`;
		const finishedProjectName = `Finished Smoke ${Date.now()}`;
		const finishedDescription = "Someone else's finished task";

		try {
			(vscode.window as any).showInformationMessage = async () => undefined;
			(vscode.window as any).showWarningMessage = async (message: string) => {
				warnings.push(message);
				return undefined;
			};
			await vscode.commands.executeCommand('dailydev-tracker.stopTask');

			// Create a finished entry through the real start/stop commands (see the comment in the
			// previous test for why db.addFinishedWorkLog can't be used directly here).
			const restoreFinishedModal = stubStartTaskModal(() => ({
				projectValue: 'add-new',
				newProjectName: finishedProjectName,
				description: finishedDescription
			}));
			await vscode.commands.executeCommand('dailydev-tracker.startTask');
			restoreFinishedModal();
			await vscode.commands.executeCommand('dailydev-tracker.stopTask');

			const restoreModal = stubStartTaskModal(() => ({
				projectValue: 'add-new',
				newProjectName: activeProjectName,
				description: 'Currently active task'
			}));
			await vscode.commands.executeCommand('dailydev-tracker.startTask');
			restoreModal();

			const fakePanel = stubGenericWebviewPanel();
			try {
				await vscode.commands.executeCommand('dailydev-tracker.showDashboard');

				const stateBefore = fakePanel.posted.at(-1)?.state as dashboard.DashboardState;
				assert.strictEqual(stateBefore.active?.label, activeProjectName);
				const id = findEntryId(stateBefore, finishedDescription);

				fakePanel.send({ type: 'resumeEntry', id });
				await new Promise((resolve) => setTimeout(resolve, 20));

				const stateAfter = fakePanel.posted.at(-1)?.state as dashboard.DashboardState;
				assert.strictEqual(stateAfter.active?.label, activeProjectName, 'the original active task must still be running');
				assert.strictEqual(stateAfter.active?.description, 'Currently active task');
				assert.ok(warnings.length > 0, 'should warn instead of silently starting a second session');
			} finally {
				fakePanel.closePanel();
				fakePanel.restore();
				await vscode.commands.executeCommand('dailydev-tracker.stopTask');
			}
		} finally {
			(vscode.window as any).showInformationMessage = originalShowInformationMessage;
			(vscode.window as any).showWarningMessage = originalShowWarningMessage;
		}
	});
});
