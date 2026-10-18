import * as vscode from 'vscode';
import * as db from './db';
import { ActiveSession, WorkCategory } from './models';
import { formatDuration } from './time';

const SESSION_KEY = 'dailydev-tracker.activeSession';

let statusBarItem: vscode.StatusBarItem | undefined;
let tickInterval: ReturnType<typeof setInterval> | undefined;

export interface TaskTarget {
	projectId: number | null;
	category: WorkCategory;
	label: string;
}

export interface StopResult {
	label: string;
	description: string;
	durationSeconds: number;
}

export type PauseResult = 'paused' | 'already-paused' | 'none';
export type ResumeResult = 'resumed' | 'not-paused' | 'none';

function ensureStatusBarItem(): vscode.StatusBarItem {
	if (!statusBarItem) {
		statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	}
	return statusBarItem;
}

export function getSession(context: vscode.ExtensionContext): ActiveSession | undefined {
	return context.globalState.get<ActiveSession>(SESSION_KEY);
}

async function setSession(context: vscode.ExtensionContext, session: ActiveSession | undefined): Promise<void> {
	await context.globalState.update(SESSION_KEY, session);
}

/** Exported for direct unit testing of the pause-exclusion math, without needing real timers. */
export function computeElapsedMs(session: ActiveSession, referenceTime: number = Date.now()): number {
	const reference = session.pausedAt ? new Date(session.pausedAt).getTime() : referenceTime;
	return reference - new Date(session.startTime).getTime() - session.accumulatedPauseMs;
}

function updateStatusBar(context: vscode.ExtensionContext): void {
	const session = getSession(context);
	const item = ensureStatusBarItem();
	if (!session) {
		item.text = '$(play) Start Task';
		item.tooltip = 'DailyDev Tracker: click to start a task';
		item.command = 'dailydev-tracker.startTask';
		item.show();
		return;
	}
	const elapsed = formatDuration(computeElapsedMs(session));
	item.text = session.pausedAt
		? `$(debug-pause) ${session.label}: ${session.description} (${elapsed})`
		: `$(clock) ${session.label}: ${session.description} (${elapsed})`;
	item.tooltip = session.pausedAt
		? 'Task paused — click to resume, stop, or switch'
		: 'Task running — click to pause, stop, or switch';
	item.command = 'dailydev-tracker.showActiveTaskMenu';
	item.show();
}

function startTicking(context: vscode.ExtensionContext): void {
	stopTicking();
	updateStatusBar(context);
	tickInterval = setInterval(() => updateStatusBar(context), 1000);
}

function stopTicking(): void {
	if (tickInterval) {
		clearInterval(tickInterval);
		tickInterval = undefined;
	}
}

export async function beginSession(context: vscode.ExtensionContext, target: TaskTarget, description: string): Promise<void> {
	if (getSession(context)) {
		throw new Error('A task is already active.');
	}
	const startTime = new Date().toISOString();
	const workLog = db.addWorkLog({ projectId: target.projectId, category: target.category, description, startTime });
	const session: ActiveSession = {
		workLogId: workLog.id,
		projectId: target.projectId,
		category: target.category,
		label: target.label,
		description,
		startTime,
		accumulatedPauseMs: 0,
		pausedAt: null
	};
	await setSession(context, session);
	startTicking(context);
}

export async function pauseSession(context: vscode.ExtensionContext): Promise<PauseResult> {
	const session = getSession(context);
	if (!session) {
		return 'none';
	}
	if (session.pausedAt) {
		return 'already-paused';
	}
	session.pausedAt = new Date().toISOString();
	await setSession(context, session);
	stopTicking();
	updateStatusBar(context);
	return 'paused';
}

export async function resumeSession(context: vscode.ExtensionContext): Promise<ResumeResult> {
	const session = getSession(context);
	if (!session) {
		return 'none';
	}
	if (!session.pausedAt) {
		return 'not-paused';
	}
	session.accumulatedPauseMs += Date.now() - new Date(session.pausedAt).getTime();
	session.pausedAt = null;
	await setSession(context, session);
	startTicking(context);
	return 'resumed';
}

export async function stopSession(context: vscode.ExtensionContext): Promise<StopResult | undefined> {
	const session = getSession(context);
	if (!session) {
		return undefined;
	}
	// If currently paused, the work actually ended when the pause began.
	const effectiveEndTime = session.pausedAt ?? new Date().toISOString();
	const durationSeconds = Math.max(
		0,
		Math.round(computeElapsedMs(session, new Date(effectiveEndTime).getTime()) / 1000)
	);
	db.finishWorkLog(session.workLogId, effectiveEndTime, durationSeconds);
	await setSession(context, undefined);
	stopTicking();
	updateStatusBar(context);
	return { label: session.label, description: session.description, durationSeconds };
}

export function hasActiveSession(context: vscode.ExtensionContext): boolean {
	return !!getSession(context);
}

export function restoreOnActivate(context: vscode.ExtensionContext): void {
	const session = getSession(context);
	if (!session) {
		updateStatusBar(context);
		return;
	}
	if (session.pausedAt) {
		updateStatusBar(context);
		vscode.window.showInformationMessage(`Resumed paused task: ${session.label} — ${session.description}`);
		return;
	}
	startTicking(context);
	vscode.window.showInformationMessage(
		`Resumed tracking: ${session.label} — ${session.description}`,
		'Stop Now'
	).then((choice) => {
		if (choice === 'Stop Now') {
			void stopSession(context).then((result) => {
				if (result) {
					vscode.window.showInformationMessage(
						`Stopped: ${result.label} — ${result.description} (${formatDuration(result.durationSeconds * 1000)})`
					);
				}
			});
		}
	});
}

export function dispose(): void {
	stopTicking();
	statusBarItem?.dispose();
	statusBarItem = undefined;
}
