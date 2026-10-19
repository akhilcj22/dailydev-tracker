import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import initSqlJs = require('sql.js');
import * as db from '../db';
import { TIMED_OUT, withTimeout } from '../db';
import { createFakeGlobalState, createFakeSecretStorage } from './testUtils';

const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'utf8');

suite('security & data protection (Phase 8)', () => {
	function freshStorageDir(): string {
		return fs.mkdtempSync(path.join(os.tmpdir(), 'dailydev-tracker-security-test-'));
	}

	function fakeContext(dir: string): vscode.ExtensionContext {
		return {
			globalStorageUri: vscode.Uri.file(dir),
			secrets: createFakeSecretStorage(),
			globalState: createFakeGlobalState()
		} as unknown as vscode.ExtensionContext;
	}

	test('the data file on disk is encrypted, not a plaintext SQLite file', async () => {
		const dir = freshStorageDir();
		await db.init(fakeContext(dir));

		const secretName = `Secret Project ${Date.now()}`;
		db.addProject(secretName);

		const dbFilePath = path.join(dir, 'dailydev-tracker.sqlite');
		const onDisk = fs.readFileSync(dbFilePath);

		assert.ok(
			!onDisk.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC),
			'the on-disk file must not start with the plaintext SQLite header'
		);
		assert.ok(
			!onDisk.toString('latin1').includes(secretName),
			'the project name must not appear as readable plaintext in the on-disk file'
		);
	});

	test('round-trips through re-initialization, as if VS Code restarted with the same keychain', async () => {
		const dir = freshStorageDir();
		const context = fakeContext(dir);
		await db.init(context);

		const projectName = `Persisted Project ${Date.now()}`;
		db.addProject(projectName);

		// Re-running init against the same context (same secrets store, same on-disk file) is
		// the closest a unit test can get to "VS Code was closed and reopened".
		await db.init(context);

		assert.ok(db.findProjectByName(projectName), 'data must still be readable after re-initializing with the same key');
	});

	if (process.platform !== 'win32') {
		test('the data file is restricted to the current user (chmod 600)', async () => {
			const dir = freshStorageDir();
			await db.init(fakeContext(dir));
			db.addProject(`Permissions Test ${Date.now()}`);

			const dbFilePath = path.join(dir, 'dailydev-tracker.sqlite');
			const mode = fs.statSync(dbFilePath).mode & 0o777;
			assert.strictEqual(mode, 0o600, `expected file mode 0600, got ${mode.toString(8)}`);
		});
	}

	test('migrates a legacy (pre-encryption) plaintext database file in place instead of quarantining it', async () => {
		const dir = freshStorageDir();
		const dbFilePath = path.join(dir, 'dailydev-tracker.sqlite');
		const legacyProjectName = `Legacy Project ${Date.now()}`;

		// Build a real, valid plaintext SQLite file the way 0.1.0 (before encryption-at-rest) did.
		const sql = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
		const legacyDb = new sql.Database();
		legacyDb.run(`
			CREATE TABLE projects (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				name TEXT NOT NULL UNIQUE COLLATE NOCASE,
				created_at TEXT NOT NULL,
				archived INTEGER NOT NULL DEFAULT 0
			);
			CREATE TABLE work_logs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				project_id INTEGER REFERENCES projects(id),
				category TEXT NOT NULL CHECK (category IN ('project', 'client-support')),
				description TEXT NOT NULL,
				start_time TEXT NOT NULL,
				end_time TEXT,
				duration_seconds INTEGER
			);
		`);
		legacyDb.run('INSERT INTO projects (name, created_at, archived) VALUES (?, ?, 0)', [legacyProjectName, new Date().toISOString()]);
		fs.writeFileSync(dbFilePath, Buffer.from(legacyDb.export()));
		assert.ok(fs.readFileSync(dbFilePath).subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC), 'test setup should produce a real plaintext SQLite file');

		await db.init(fakeContext(dir));

		assert.ok(db.findProjectByName(legacyProjectName), 'the pre-existing project must survive the migration');

		const afterMigration = fs.readFileSync(dbFilePath);
		assert.ok(
			!afterMigration.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC),
			'the file must be re-saved encrypted after loading a legacy plaintext database'
		);
	});

	test('withTimeout resolves to TIMED_OUT when the underlying promise is slower than the deadline', async () => {
		const neverResolves = new Promise<string>(() => {
			/* intentionally never settles, simulating a hung keychain call */
		});
		const result = await withTimeout(neverResolves, 20);
		assert.strictEqual(result, TIMED_OUT);
	});

	test('withTimeout resolves with the real value when the promise settles before the deadline', async () => {
		const result = await withTimeout(Promise.resolve('value'), 1000);
		assert.strictEqual(result, 'value');
	});
});
