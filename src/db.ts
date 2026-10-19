import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import initSqlJs = require('sql.js');
import { NewWorkLog, Project, WorkCategory, WorkLog, WorkLogWithProjectName } from './models';

let sql: import('sql.js').SqlJsStatic;
let db: import('sql.js').Database;
let dbFilePath: string;
let dbKey: Buffer;

const DB_KEY_SECRET_ID = 'dailydev-tracker.dbEncryptionKey';
const USE_FALLBACK_KEY_STORAGE_FLAG = 'dailydev-tracker.useFallbackKeyStorage';
const FALLBACK_KEY_FILENAME = '.dailydev-tracker.key';
const SECRET_STORAGE_TIMEOUT_MS = 3000;
// Real SQLite files start with this magic header; used to detect a pre-encryption (0.1.0 and
// earlier) plaintext data file so it can be migrated in place instead of being quarantined as corrupt.
const SQLITE_MAGIC = Buffer.from('SQLite format 3\0', 'utf8');

/** Exported so the resilience mechanism can be unit-tested with a short artificial delay, without waiting out the real SECRET_STORAGE_TIMEOUT_MS on every test run. */
export const TIMED_OUT = Symbol('secret-storage-timed-out');

/**
 * VS Code's SecretStorage relies on an OS keychain (Credential Manager / Keychain / Linux
 * Secret Service). On a Linux box with no secret-service daemon running — a bare WSL2 install,
 * for instance — a call into it can hang for several seconds (or longer) instead of failing
 * fast. Racing it against a timeout keeps a missing keychain from blocking extension activation.
 */
export function withTimeout<T>(promise: Thenable<T>, ms: number): Promise<T | typeof TIMED_OUT> {
	return new Promise((resolve) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				resolve(TIMED_OUT);
			}
		}, ms);
		Promise.resolve(promise).then(
			(value) => {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					resolve(value);
				}
			},
			() => {
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					resolve(TIMED_OUT);
				}
			}
		);
	});
}

function readOrCreateFallbackKeyFile(storageDir: string): Buffer {
	const fallbackKeyPath = path.join(storageDir, FALLBACK_KEY_FILENAME);
	if (fs.existsSync(fallbackKeyPath)) {
		return fs.readFileSync(fallbackKeyPath);
	}
	const key = crypto.randomBytes(32);
	fs.writeFileSync(fallbackKeyPath, key);
	try {
		fs.chmodSync(fallbackKeyPath, 0o600);
	} catch {
		// Best-effort; see the matching comment in persist().
	}
	return key;
}

/**
 * Prefers the OS keychain via SecretStorage; falls back to a file-based key (still random,
 * still file-permission-restricted) when the keychain is slow or unavailable, and remembers that
 * choice in globalState so later activations go straight to the fallback instead of re-paying a
 * multi-second delay on every startup.
 */
async function getOrCreateKey(context: vscode.ExtensionContext, storageDir: string): Promise<Buffer> {
	const alreadyUsingFallback = context.globalState.get<boolean>(USE_FALLBACK_KEY_STORAGE_FLAG, false);

	if (!alreadyUsingFallback) {
		const existing = await withTimeout(context.secrets.get(DB_KEY_SECRET_ID), SECRET_STORAGE_TIMEOUT_MS);
		if (existing !== TIMED_OUT) {
			if (existing) {
				return Buffer.from(existing, 'base64');
			}
			const key = crypto.randomBytes(32);
			const stored = await withTimeout(context.secrets.store(DB_KEY_SECRET_ID, key.toString('base64')), SECRET_STORAGE_TIMEOUT_MS);
			if (stored !== TIMED_OUT) {
				return key;
			}
		}
		await context.globalState.update(USE_FALLBACK_KEY_STORAGE_FLAG, true);
	}

	return readOrCreateFallbackKeyFile(storageDir);
}

/** AES-256-GCM: random 12-byte IV and 16-byte auth tag are stored alongside the ciphertext. */
function encrypt(data: Buffer): Buffer {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', dbKey, iv);
	const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function decrypt(data: Buffer): Buffer {
	const iv = data.subarray(0, 12);
	const authTag = data.subarray(12, 28);
	const ciphertext = data.subarray(28);
	const decipher = crypto.createDecipheriv('aes-256-gcm', dbKey, iv);
	decipher.setAuthTag(authTag);
	return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

const SCHEMA = `
	CREATE TABLE IF NOT EXISTS projects (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE COLLATE NOCASE,
		created_at TEXT NOT NULL,
		archived INTEGER NOT NULL DEFAULT 0
	);
	CREATE TABLE IF NOT EXISTS work_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		project_id INTEGER REFERENCES projects(id),
		category TEXT NOT NULL CHECK (category IN ('project', 'client-support')),
		description TEXT NOT NULL,
		start_time TEXT NOT NULL,
		end_time TEXT,
		duration_seconds INTEGER
	);
`;

export async function init(context: vscode.ExtensionContext): Promise<void> {
	const storageDir = context.globalStorageUri.fsPath;
	fs.mkdirSync(storageDir, { recursive: true });
	dbFilePath = path.join(storageDir, 'dailydev-tracker.sqlite');
	dbKey = await getOrCreateKey(context, storageDir);

	sql = await initSqlJs({
		locateFile: (file: string) => path.join(__dirname, file)
	});

	const onDisk = fs.existsSync(dbFilePath) ? fs.readFileSync(dbFilePath) : undefined;
	try {
		const isLegacyPlaintext = onDisk && onDisk.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC);
		// A legacy plaintext file (from before encryption-at-rest) is migrated in place: load it as-is,
		// then the unconditional persist() below re-saves it encrypted.
		const existing = isLegacyPlaintext ? onDisk : onDisk ? decrypt(onDisk) : undefined;
		db = new sql.Database(existing);
		db.run(SCHEMA);
	} catch (error) {
		// A corrupted (or unreadable — e.g. wrong/lost key) data file would otherwise crash
		// activate() on every startup, permanently bricking the extension. Quarantine it and start
		// fresh so tracking keeps working — losing unreadable history is better than losing the
		// extension entirely.
		if (onDisk) {
			const quarantinePath = `${dbFilePath}.corrupt-${Date.now()}`;
			fs.renameSync(dbFilePath, quarantinePath);
			vscode.window.showErrorMessage(
				`DailyDev Tracker's data file was unreadable and has been moved to ${quarantinePath}. Starting with a fresh database.`
			);
		}
		db = new sql.Database();
		db.run(SCHEMA);
	}
	persist();
}

function persist(): void {
	const data = encrypt(Buffer.from(db.export()));
	fs.writeFileSync(dbFilePath, data);
	try {
		// Best-effort: restrict the data file to the current OS user. Some filesystems (exFAT,
		// some Windows configurations) don't support POSIX permission bits — encryption at rest is
		// the primary protection, this is defense in depth where the OS allows it.
		fs.chmodSync(dbFilePath, 0o600);
	} catch {
		// Ignored — see comment above.
	}
}

export function addProject(name: string): Project {
	db.run('INSERT INTO projects (name, created_at, archived) VALUES (?, ?, 0)', [name, new Date().toISOString()]);
	const id = getLastInsertRowId();
	persist();
	return { id, name, createdAt: new Date().toISOString(), archived: false };
}

export function listProjects(includeArchived = false): Project[] {
	const result = db.exec(
		includeArchived
			? 'SELECT id, name, created_at, archived FROM projects ORDER BY name COLLATE NOCASE'
			: 'SELECT id, name, created_at, archived FROM projects WHERE archived = 0 ORDER BY name COLLATE NOCASE'
	);
	if (result.length === 0) {
		return [];
	}
	return result[0].values.map((row) => ({
		id: Number(row[0]),
		name: String(row[1]),
		createdAt: String(row[2]),
		archived: Number(row[3]) === 1
	}));
}

export function findProjectByName(name: string): Project | undefined {
	return listProjects(true).find((p) => p.name.toLowerCase() === name.toLowerCase());
}

export function addWorkLog(entry: NewWorkLog): WorkLog {
	db.run(
		'INSERT INTO work_logs (project_id, category, description, start_time, end_time, duration_seconds) VALUES (?, ?, ?, ?, NULL, NULL)',
		[entry.projectId, entry.category, entry.description, entry.startTime]
	);
	const id = getLastInsertRowId();
	persist();
	return {
		id,
		projectId: entry.projectId,
		category: entry.category as WorkCategory,
		description: entry.description,
		startTime: entry.startTime,
		endTime: null,
		durationSeconds: null
	};
}

function getLastInsertRowId(): number {
	const result = db.exec('SELECT last_insert_rowid()');
	return Number(result[0].values[0][0]);
}

function rowToWorkLog(row: (string | number | Uint8Array | null)[]): WorkLog {
	return {
		id: Number(row[0]),
		projectId: row[1] === null ? null : Number(row[1]),
		category: row[2] as WorkCategory,
		description: String(row[3]),
		startTime: String(row[4]),
		endTime: row[5] === null ? null : String(row[5]),
		durationSeconds: row[6] === null ? null : Number(row[6])
	};
}

export function getWorkLog(id: number): WorkLog | undefined {
	const result = db.exec(
		'SELECT id, project_id, category, description, start_time, end_time, duration_seconds FROM work_logs WHERE id = ?',
		[id]
	);
	if (result.length === 0) {
		return undefined;
	}
	return rowToWorkLog(result[0].values[0]);
}

export function finishWorkLog(id: number, endTime: string, durationSeconds: number): void {
	db.run('UPDATE work_logs SET end_time = ?, duration_seconds = ? WHERE id = ?', [endTime, durationSeconds, id]);
	persist();
}

export function listFinishedWorkLogs(limit: number): WorkLogWithProjectName[] {
	const result = db.exec(
		`SELECT w.id, w.project_id, w.category, w.description, w.start_time, w.end_time, w.duration_seconds,
				COALESCE(p.name, 'Client Support') AS project_name
		 FROM work_logs w
		 LEFT JOIN projects p ON p.id = w.project_id
		 WHERE w.end_time IS NOT NULL
		 ORDER BY w.start_time DESC
		 LIMIT ?`,
		[limit]
	);
	if (result.length === 0) {
		return [];
	}
	return result[0].values.map((row) => ({
		...rowToWorkLog(row.slice(0, 7)),
		projectName: String(row[7])
	}));
}

export function updateWorkLogDuration(id: number, durationSeconds: number): WorkLog {
	const log = getWorkLog(id);
	if (!log) {
		throw new Error(`Work log ${id} not found`);
	}
	const endTime = new Date(new Date(log.startTime).getTime() + durationSeconds * 1000).toISOString();
	db.run('UPDATE work_logs SET end_time = ?, duration_seconds = ? WHERE id = ?', [endTime, durationSeconds, id]);
	persist();
	return { ...log, endTime, durationSeconds };
}

export function updateWorkLogDescription(id: number, description: string): WorkLog {
	const log = getWorkLog(id);
	if (!log) {
		throw new Error(`Work log ${id} not found`);
	}
	db.run('UPDATE work_logs SET description = ? WHERE id = ?', [description, id]);
	persist();
	return { ...log, description };
}

export function listFinishedWorkLogsBetween(startIso: string, endIso: string): WorkLogWithProjectName[] {
	const result = db.exec(
		`SELECT w.id, w.project_id, w.category, w.description, w.start_time, w.end_time, w.duration_seconds,
				COALESCE(p.name, 'Client Support') AS project_name
		 FROM work_logs w
		 LEFT JOIN projects p ON p.id = w.project_id
		 WHERE w.end_time IS NOT NULL AND w.start_time >= ? AND w.start_time < ?
		 ORDER BY w.start_time ASC`,
		[startIso, endIso]
	);
	if (result.length === 0) {
		return [];
	}
	return result[0].values.map((row) => ({
		...rowToWorkLog(row.slice(0, 7)),
		projectName: String(row[7])
	}));
}

export function listRecentDescriptions(projectId: number | null, limit: number): string[] {
	const result = db.exec(
		`SELECT description, MAX(start_time) AS last_used
		 FROM work_logs
		 WHERE project_id IS ?
		 GROUP BY description
		 ORDER BY last_used DESC
		 LIMIT ?`,
		[projectId, limit]
	);
	if (result.length === 0) {
		return [];
	}
	return result[0].values.map((row) => String(row[0]));
}

export function addFinishedWorkLog(entry: {
	projectId: number | null;
	category: WorkCategory;
	description: string;
	startTime: string;
	endTime: string;
	durationSeconds: number;
}): WorkLog {
	db.run(
		'INSERT INTO work_logs (project_id, category, description, start_time, end_time, duration_seconds) VALUES (?, ?, ?, ?, ?, ?)',
		[entry.projectId, entry.category, entry.description, entry.startTime, entry.endTime, entry.durationSeconds]
	);
	const id = getLastInsertRowId();
	persist();
	return {
		id,
		projectId: entry.projectId,
		category: entry.category,
		description: entry.description,
		startTime: entry.startTime,
		endTime: entry.endTime,
		durationSeconds: entry.durationSeconds
	};
}
