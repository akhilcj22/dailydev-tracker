import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as db from '../db';

suite('db', () => {
	// Uses its own isolated SQLite file under a fresh temp dir, independent of the live
	// extension's data — this exercises db.ts's query logic directly, not through commands.
	async function freshDb(): Promise<void> {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dailydev-tracker-db-test-'));
		const fakeContext = { globalStorageUri: vscode.Uri.file(dir) } as unknown as vscode.ExtensionContext;
		await db.init(fakeContext);
	}

	test('listRecentDescriptions returns distinct descriptions, most recent first, scoped per project', async () => {
		await freshDb();

		const projectA = db.addProject(`Project A ${Date.now()}`);
		const projectB = db.addProject(`Project B ${Date.now()}`);

		const baseTime = Date.now();
		const at = (offsetMs: number) => new Date(baseTime + offsetMs).toISOString();

		// Project A: three distinct descriptions, plus a repeat of the oldest one (should not
		// duplicate in the result, and its most recent use should win for ordering).
		db.addFinishedWorkLog({ projectId: projectA.id, category: 'project', description: 'Oldest task', startTime: at(0), endTime: at(60_000), durationSeconds: 60 });
		db.addFinishedWorkLog({ projectId: projectA.id, category: 'project', description: 'Middle task', startTime: at(60_000), endTime: at(120_000), durationSeconds: 60 });
		db.addFinishedWorkLog({ projectId: projectA.id, category: 'project', description: 'Newest task', startTime: at(120_000), endTime: at(180_000), durationSeconds: 60 });
		db.addFinishedWorkLog({ projectId: projectA.id, category: 'project', description: 'Oldest task', startTime: at(180_000), endTime: at(240_000), durationSeconds: 60 });

		// Project B: unrelated entry that must not leak into Project A's suggestions.
		db.addFinishedWorkLog({ projectId: projectB.id, category: 'project', description: 'Other project task', startTime: at(0), endTime: at(60_000), durationSeconds: 60 });

		// Client Support: project_id is NULL, must not be confused with a real project's rows.
		db.addFinishedWorkLog({ projectId: null, category: 'client-support', description: 'Support ticket', startTime: at(0), endTime: at(60_000), durationSeconds: 60 });

		const recentA = db.listRecentDescriptions(projectA.id, 3);
		assert.deepStrictEqual(recentA, ['Oldest task', 'Newest task', 'Middle task'], 'repeated description re-surfaces by its latest use, without duplicating');

		const recentB = db.listRecentDescriptions(projectB.id, 3);
		assert.deepStrictEqual(recentB, ['Other project task']);

		const recentSupport = db.listRecentDescriptions(null, 3);
		assert.deepStrictEqual(recentSupport, ['Support ticket']);
	});

	test('listRecentDescriptions respects the limit', async () => {
		await freshDb();

		const project = db.addProject(`Limit Test ${Date.now()}`);
		const baseTime = Date.now();
		for (let i = 0; i < 5; i++) {
			db.addFinishedWorkLog({
				projectId: project.id,
				category: 'project',
				description: `Task ${i}`,
				startTime: new Date(baseTime + i * 60_000).toISOString(),
				endTime: new Date(baseTime + (i + 1) * 60_000).toISOString(),
				durationSeconds: 60
			});
		}

		const recent = db.listRecentDescriptions(project.id, 3);
		assert.strictEqual(recent.length, 3);
		assert.deepStrictEqual(recent, ['Task 4', 'Task 3', 'Task 2']);
	});
});
