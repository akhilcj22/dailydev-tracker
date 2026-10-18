import * as vscode from 'vscode';
import { fromIstComponents, toIstCalendar } from './istTime';

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

// All scheduling below is anchored to IST calendar days/hours (via istTime.ts), not the host
// system's local timezone — the extension's process may run under a system clock set to a
// different zone (e.g. UTC on a WSL2 host) than the user's actual IST location.

export function todayKey(date: Date): string {
	const cal = toIstCalendar(date);
	return `${cal.getUTCFullYear()}-${cal.getUTCMonth() + 1}-${cal.getUTCDate()}`;
}

export function reminderTimeOn(date: Date, config: ReminderConfig): Date {
	const cal = toIstCalendar(date);
	return fromIstComponents(cal.getUTCFullYear(), cal.getUTCMonth(), cal.getUTCDate(), config.hour, config.minute);
}

/** Finds the reminder time on the first working day on/after `from` (scanning up to a week), in IST. */
export function nextWorkingDayAtReminderTime(from: Date, config: ReminderConfig): Date {
	const cal = toIstCalendar(from);
	const candidate = new Date(Date.UTC(cal.getUTCFullYear(), cal.getUTCMonth(), cal.getUTCDate()));
	for (let i = 0; i < 8; i++) {
		if (config.workingDays.has(candidate.getUTCDay())) {
			return fromIstComponents(candidate.getUTCFullYear(), candidate.getUTCMonth(), candidate.getUTCDate(), config.hour, config.minute);
		}
		candidate.setUTCDate(candidate.getUTCDate() + 1);
	}
	// No working days configured at all; fall back to tomorrow so this never fires immediately in a loop.
	const fallback = new Date(Date.UTC(cal.getUTCFullYear(), cal.getUTCMonth(), cal.getUTCDate() + 1));
	return fromIstComponents(fallback.getUTCFullYear(), fallback.getUTCMonth(), fallback.getUTCDate(), config.hour, config.minute);
}

/** The next strictly-future reminder moment (IST): later today if still upcoming, else the next working day. */
export function computeNextFireTime(now: Date, config: ReminderConfig): Date {
	const todayCandidate = reminderTimeOn(now, config);
	const nowCal = toIstCalendar(now);
	if (config.workingDays.has(nowCal.getUTCDay()) && todayCandidate.getTime() > now.getTime()) {
		return todayCandidate;
	}
	// IST has no DST, so adding exactly 24h always lands on the next IST calendar day.
	const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
	return nextWorkingDayAtReminderTime(tomorrow, config);
}

export function decideOnActivate(now: Date, config: ReminderConfig, alreadyShownToday: boolean): ActivationDecision {
	if (!config.enabled) {
		return { action: 'disabled' };
	}
	const isWorkingDay = config.workingDays.has(toIstCalendar(now).getUTCDay());
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
