import * as vscode from 'vscode';

const LAST_REMINDER_KEY = 'dailydev-tracker.lastReminderDate';
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CONFIG_SECTION = 'dailydevTracker';

export interface ReminderConfig {
	enabled: boolean;
	hour: number;
	minute: number;
	workingDays: Set<number>;
}

export type ActivationDecision = { action: 'disabled' } | { action: 'catch-up' } | { action: 'schedule'; fireAt: Date };

let timer: ReturnType<typeof setTimeout> | undefined;
let configListener: vscode.Disposable | undefined;

export function readConfig(): ReminderConfig {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const enabled = config.get<boolean>('reminderEnabled', true);
	const timeStr = config.get<string>('reminderTime', '18:00');
	const match = /^(\d{1,2}):(\d{2})$/.exec(timeStr);
	const hour = match ? Number(match[1]) : 18;
	const minute = match ? Number(match[2]) : 0;
	const days = config.get<string[]>('workingDays', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
	const workingDays = new Set(days.map((d) => DAY_NAMES.indexOf(d)).filter((i) => i >= 0));
	return {
		enabled,
		hour: hour >= 0 && hour <= 23 ? hour : 18,
		minute: minute >= 0 && minute <= 59 ? minute : 0,
		workingDays
	};
}

export function todayKey(date: Date): string {
	return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function reminderTimeOn(date: Date, config: ReminderConfig): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate(), config.hour, config.minute, 0, 0);
}

/** Finds the reminder time on the first working day on/after `from` (scanning up to a week). */
export function nextWorkingDayAtReminderTime(from: Date, config: ReminderConfig): Date {
	const candidate = new Date(from.getFullYear(), from.getMonth(), from.getDate());
	for (let i = 0; i < 8; i++) {
		if (config.workingDays.has(candidate.getDay())) {
			return reminderTimeOn(candidate, config);
		}
		candidate.setDate(candidate.getDate() + 1);
	}
	// No working days configured at all; fall back to tomorrow so this never fires immediately in a loop.
	const fallback = new Date(from);
	fallback.setDate(fallback.getDate() + 1);
	return reminderTimeOn(fallback, config);
}

/** The next strictly-future reminder moment: later today if still upcoming, else the next working day. */
export function computeNextFireTime(now: Date, config: ReminderConfig): Date {
	const todayCandidate = reminderTimeOn(now, config);
	if (config.workingDays.has(now.getDay()) && todayCandidate.getTime() > now.getTime()) {
		return todayCandidate;
	}
	const tomorrow = new Date(now);
	tomorrow.setDate(tomorrow.getDate() + 1);
	return nextWorkingDayAtReminderTime(tomorrow, config);
}

export function decideOnActivate(now: Date, config: ReminderConfig, alreadyShownToday: boolean): ActivationDecision {
	if (!config.enabled) {
		return { action: 'disabled' };
	}
	const isWorkingDay = config.workingDays.has(now.getDay());
	const todaysReminderTime = reminderTimeOn(now, config);
	if (isWorkingDay && !alreadyShownToday && now.getTime() >= todaysReminderTime.getTime()) {
		return { action: 'catch-up' };
	}
	return { action: 'schedule', fireAt: computeNextFireTime(now, config) };
}

async function showReminder(context: vscode.ExtensionContext): Promise<void> {
	await context.globalState.update(LAST_REMINDER_KEY, todayKey(new Date()));
	const choice = await vscode.window.showInformationMessage('Time to review your tracked tasks for today.', 'Open Dashboard');
	if (choice === 'Open Dashboard') {
		await vscode.commands.executeCommand('dailydev-tracker.showDashboard');
	}
}

function clearTimer(): void {
	if (timer) {
		clearTimeout(timer);
		timer = undefined;
	}
}

function scheduleNext(context: vscode.ExtensionContext): void {
	clearTimer();
	const config = readConfig();
	if (!config.enabled) {
		return;
	}
	const now = new Date();
	const fireAt = computeNextFireTime(now, config);
	const delay = fireAt.getTime() - now.getTime();
	timer = setTimeout(() => {
		void showReminder(context).finally(() => scheduleNext(context));
	}, delay);
}

export function activateReminders(context: vscode.ExtensionContext): void {
	const config = readConfig();
	const now = new Date();
	const alreadyShownToday = context.globalState.get<string>(LAST_REMINDER_KEY) === todayKey(now);
	const decision = decideOnActivate(now, config, alreadyShownToday);

	if (decision.action === 'catch-up') {
		void showReminder(context).finally(() => scheduleNext(context));
	} else if (decision.action === 'schedule') {
		scheduleNext(context);
	}

	configListener = vscode.workspace.onDidChangeConfiguration((e) => {
		if (
			e.affectsConfiguration(`${CONFIG_SECTION}.reminderEnabled`) ||
			e.affectsConfiguration(`${CONFIG_SECTION}.reminderTime`) ||
			e.affectsConfiguration(`${CONFIG_SECTION}.workingDays`)
		) {
			scheduleNext(context);
		}
	});
}

export function dispose(): void {
	clearTimer();
	configListener?.dispose();
	configListener = undefined;
}
