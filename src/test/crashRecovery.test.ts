import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as db from '../db';
import * as session from '../session';
import { createFakeGlobalState, createFakeSecretStorage } from './testUtils';

suite('crash recovery (Phase 7)', () => {
	async function freshContext(): Promise<vscode.ExtensionContext> {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dailydev-tracker-crash-test-'));
		const fakeContext = {
			globalStorageUri: vscode.Uri.file(dir),
			secrets: createFakeSecretStorage(),
			globalState: (() => {
				const store = new Map<string, unknown>();
				return {
					get: (key: string) => store.get(key),
					update: async (key: string, value: unknown) => {
						store.set(key, value);
					}
				};
			})()
		} as unknown as vscode.ExtensionContext;
		await db.init(fakeContext);
		return fakeContext;
	}

	async function flushAsyncWork(): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, 20));
	}

	test('restoreOnActivate offers to stop a dangling running session, and Stop Now finishes it', async () => {
		const context = await freshContext();
		const project = db.addProject(`Crash Recovery Running ${Date.now()}`);

		await session.beginSession(
			context,
			{ projectId: project.id, category: 'project', label: project.name },
			'Interrupted task',
			new Date(Date.now() - 60_000).toISOString()
		);
		// Simulate VS Code having been killed without a clean deactivate: the in-memory ticking
		// state is gone, but the session survives in globalState for restoreOnActivate to find.
		session.dispose();

		const originalShowInformationMessage = vscode.window.showInformationMessage;
		const infoMessages: string[] = [];
		(vscode.window as any).showInformationMessage = async (message: string, ...items: string[]) => {
			infoMessages.push(message);
			return items[0];
		};

		try {
			session.restoreOnActivate(context);
			await flushAsyncWork();
		} finally {
			(vscode.window as any).showInformationMessage = originalShowInformationMessage;
			session.dispose();
		}

		assert.ok(
			infoMessages.some((m) => m.startsWith('Resumed tracking:') && m.includes('Interrupted task')),
			'expected the dangling session to be announced as resumed'
		);
		assert.ok(
			infoMessages.some((m) => m.startsWith('Stopped:') && m.includes('Interrupted task')),
			'choosing "Stop Now" should finish the recovered session'
		);
		assert.strictEqual(session.getSession(context), undefined, 'session should be cleared after Stop Now');
	});

	test('restoreOnActivate notices a dangling paused session without auto-stopping it', async () => {
		const context = await freshContext();
		const project = db.addProject(`Crash Recovery Paused ${Date.now()}`);

		await session.beginSession(
			context,
			{ projectId: project.id, category: 'project', label: project.name },
			'Paused task',
			new Date(Date.now() - 120_000).toISOString()
		);
		await session.pauseSession(context);
		session.dispose();

		const originalShowInformationMessage = vscode.window.showInformationMessage;
		const infoMessages: string[] = [];
		(vscode.window as any).showInformationMessage = async (message: string) => {
			infoMessages.push(message);
			return undefined;
		};

		const sessionBefore = session.getSession(context);

		try {
			session.restoreOnActivate(context);
			await flushAsyncWork();
		} finally {
			(vscode.window as any).showInformationMessage = originalShowInformationMessage;
			session.dispose();
		}

		assert.ok(
			infoMessages.some((m) => m.startsWith('Resumed paused task:') && m.includes('Paused task')),
			'expected the dangling paused session to be announced'
		);
		// A paused session must stay intact (not silently finished) until the user explicitly resumes/stops it.
		assert.deepStrictEqual(session.getSession(context), sessionBefore);
	});

	test('db.init quarantines an unreadable data file and starts fresh instead of crashing', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dailydev-tracker-corrupt-test-'));
		const dbFilePath = path.join(dir, 'dailydev-tracker.sqlite');
		fs.writeFileSync(dbFilePath, 'this is not a valid sqlite file');

		const originalShowErrorMessage = vscode.window.showErrorMessage;
		const errorMessages: string[] = [];
		(vscode.window as any).showErrorMessage = async (message: string) => {
			errorMessages.push(message);
			return undefined;
		};

		try {
			const fakeContext = {
				globalStorageUri: vscode.Uri.file(dir),
				secrets: createFakeSecretStorage(),
				globalState: createFakeGlobalState()
			} as unknown as vscode.ExtensionContext;
			await db.init(fakeContext);

			// The extension must still be usable after recovering from corruption.
			const project = db.addProject(`Post Recovery ${Date.now()}`);
			assert.ok(project.id > 0);

			assert.ok(errorMessages.some((m) => m.includes('unreadable')), 'expected a warning about the corrupt file');

			const remainingFiles = fs.readdirSync(dir);
			assert.ok(
				remainingFiles.some((f) => f.startsWith('dailydev-tracker.sqlite.corrupt-')),
				'the corrupt file should be quarantined, not silently deleted'
			);
			assert.ok(fs.existsSync(dbFilePath), 'a fresh database file should be written in its place');
		} finally {
			(vscode.window as any).showErrorMessage = originalShowErrorMessage;
		}
	});
});
