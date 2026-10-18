// India Standard Time is a fixed UTC+5:30 offset with no daylight saving, so it can be modeled
// as a constant shift rather than needing a timezone database. This matters because the
// extension's Node.js process may run under a system clock set to a different timezone (e.g. a
// WSL2 host defaulting to UTC) than the user's actual location, so `new Date()`'s local getters
// cannot be trusted to reflect IST wall-clock time.

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** A Date whose UTC year/month/day/hour/minute/weekday fields equal the IST wall-clock fields of `instant`. */
export function toIstCalendar(instant: Date): Date {
	return new Date(instant.getTime() + IST_OFFSET_MS);
}

/** The real instant (UTC) corresponding to the given IST wall-clock components. */
export function fromIstComponents(year: number, month: number, day: number, hour: number, minute: number, second = 0): Date {
	return new Date(Date.UTC(year, month, day, hour, minute, second) - IST_OFFSET_MS);
}

/** The real instant for "hour:minute IST" on the same IST calendar day as `reference`. */
export function istWallClockOn(reference: Date, hour: number, minute: number): Date {
	const cal = toIstCalendar(reference);
	return fromIstComponents(cal.getUTCFullYear(), cal.getUTCMonth(), cal.getUTCDate(), hour, minute);
}

export function formatIstTime24h(instant: Date): string {
	const cal = toIstCalendar(instant);
	const pad = (n: number) => n.toString().padStart(2, '0');
	return `${pad(cal.getUTCHours())}:${pad(cal.getUTCMinutes())}`;
}

export function formatIstTime12h(instant: Date): string {
	const cal = toIstCalendar(instant);
	const hour = cal.getUTCHours();
	const minute = cal.getUTCMinutes();
	const pad = (n: number) => n.toString().padStart(2, '0');
	const period = hour >= 12 ? 'PM' : 'AM';
	const hour12 = hour % 12 === 0 ? 12 : hour % 12;
	return `${hour12}:${pad(minute)} ${period}`;
}

export function formatIstDateTime(instant: Date): string {
	const cal = toIstCalendar(instant);
	return `${cal.getUTCMonth() + 1}/${cal.getUTCDate()}/${cal.getUTCFullYear()}, ${formatIstTime12h(instant)}`;
}
