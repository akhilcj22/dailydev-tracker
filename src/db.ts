import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import initSqlJs = require('sql.js');
import { NewWorkLog, Project, WorkCategory, WorkLog, WorkLogWithProjectName } from './models';

let sql: import('sql.js').SqlJsStatic;
let db: import('sql.js').Database;
let dbFilePath: string;

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

	sql = await initSqlJs({
		locateFile: (file: string) => path.join(__dirname, file)
	});

	const existing = fs.existsSync(dbFilePath) ? fs.readFileSync(dbFilePath) : undefined;
	db = new sql.Database(existing);
	db.run(SCHEMA);
	persist();
}

function persist(): void {
	const data = Buffer.from(db.export());
	fs.writeFileSync(dbFilePath, data);
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
