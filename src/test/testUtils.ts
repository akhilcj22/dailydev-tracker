import * as vscode from 'vscode';
import { formatIstTime24h } from '../istTime';

/**
 * In-memory SecretStorage stand-in for tests that construct a fake ExtensionContext directly
 * (db.init needs `context.secrets` to get/create its encryption key).
 */
export function createFakeSecretStorage(): {
	get: (key: string) => Thenable<string | undefined>;
	store: (key: string, value: string) => Thenable<void>;
	delete: (key: string) => Thenable<void>;
} {
	const store = new Map<string, string>();
	return {
		get: async (key) => store.get(key),
		store: async (key, value) => {
			store.set(key, value);
		},
		delete: async (key) => {
			store.delete(key);
		}
	};
}

/**
 * In-memory globalState stand-in for tests that construct a fake ExtensionContext directly
 * (db.init reads/writes a flag here to remember when SecretStorage is unavailable).
 */
export function createFakeGlobalState(): {
	get: <T>(key: string, defaultValue?: T) => T | undefined;
	update: (key: string, value: unknown) => Thenable<void>;
} {
	const store = new Map<string, unknown>();
	return {
		get: <T>(key: string, defaultValue?: T) => (store.has(key) ? (store.get(key) as T) : defaultValue),
		update: async (key, value) => {
			store.set(key, value);
		}
	};
}

function createFakePanel(onMessageRegistered: (messageHandler: (message: Record<string, unknown>) => void) => void) {
	let messageHandler: ((message: Record<string, unknown>) => void) | undefined;
	let capturedHtml = '';
	return {
		webview: {
			postMessage: async () => true,
			onDidReceiveMessage: (callback: (message: Record<string, unknown>) => void) => {
				messageHandler = callback;
				onMessageRegistered(callback);
				return { dispose() {} };
			},
			set html(value: string) {
				capturedHtml = value;
			},
			get html() {
				return capturedHtml;
			}
		},
		onDidDispose: () => ({ dispose() {} }),
		onDidChangeViewState: () => ({ dispose() {} }),
		reveal: () => {},
		dispose: () => {},
		visible: true,
		get _messageHandler() {
			return messageHandler;
		},
		get _html() {
			return capturedHtml;
		}
	};
}

/**
 * Intercepts vscode.window.createWebviewPanel so that the next single-field modal input popup
 * (src/modal.ts's showModalInput) resolves immediately with the given value, instead of
 * waiting for a real click/keystroke inside the webview. Scope this tightly around just the
 * command call that triggers the modal, then call the returned restore function — leaving it
 * active would also hijack unrelated webview panels (like the dashboard or the start-task modal).
 */
export function stubModalInput(value: string | undefined): () => void {
	const original = vscode.window.createWebviewPanel;

	(vscode.window as unknown as { createWebviewPanel: unknown }).createWebviewPanel = () => {
		const fakePanel = createFakePanel(() => {
			queueMicrotask(() => {
				fakePanel._messageHandler?.(value === undefined ? { type: 'cancel' } : { type: 'submit', value });
			});
		});
		return fakePanel as unknown as vscode.WebviewPanel;
	};

	return () => {
		(vscode.window as unknown as { createWebviewPanel: unknown }).createWebviewPanel = original;
	};
}

export interface StartTaskSubmission {
	projectValue: string;
	newProjectName?: string;
	description: string;
	/** Defaults to the current time (HH:mm) when omitted, matching the popup's own default. */
	startTime?: string;
}

function nowHHMM(): string {
	// The real popup's default is computed via formatIstTime24h (src/startTaskModal.ts), and its
	// validation now interprets this string as IST wall-clock — so the stub must match, or it can
	// submit a value that reads as "in the future" once reinterpreted as IST.
	return formatIstTime24h(new Date());
}

/**
 * Intercepts vscode.window.createWebviewPanel so that the next "start task" modal
 * (src/startTaskModal.ts) resolves with a submission built from the real generated HTML —
 * letting the test read out the actual `p:<id>` option value for an existing project by name,
 * without needing a separate way to query project ids.
 */
export function stubStartTaskModal(buildSubmission: (html: string) => StartTaskSubmission | undefined): () => void {
	const original = vscode.window.createWebviewPanel;

	(vscode.window as unknown as { createWebviewPanel: unknown }).createWebviewPanel = () => {
		const fakePanel = createFakePanel(() => {
			queueMicrotask(() => {
				const submission = buildSubmission(fakePanel._html);
				fakePanel._messageHandler?.(
					submission ? { type: 'submit', startTime: nowHHMM(), ...submission } : { type: 'cancel' }
				);
			});
		});
		return fakePanel as unknown as vscode.WebviewPanel;
	};

	return () => {
		(vscode.window as unknown as { createWebviewPanel: unknown }).createWebviewPanel = original;
	};
}

export interface FakeWebviewPanelHandle {
	/** Messages the extension host posted back to the webview, in order. */
	readonly posted: Record<string, unknown>[];
	/** Simulates the webview sending a message to the extension host (e.g. a button click). */
	send(message: Record<string, unknown>): void;
	restore(): void;
}

/**
 * Intercepts vscode.window.createWebviewPanel with a bare-bones fake panel that records every
 * postMessage call and lets the test drive the panel's onDidReceiveMessage handler directly —
 * for panels like the dashboard that run an ongoing message protocol, rather than resolving once
 * like the single-shot modals above.
 */
export function stubGenericWebviewPanel(): FakeWebviewPanelHandle {
	const original = vscode.window.createWebviewPanel;
	const posted: Record<string, unknown>[] = [];
	let messageHandler: ((message: Record<string, unknown>) => void) | undefined;

	(vscode.window as unknown as { createWebviewPanel: unknown }).createWebviewPanel = () => {
		const fakePanel = {
			webview: {
				postMessage: async (message: Record<string, unknown>) => {
					posted.push(message);
					return true;
				},
				onDidReceiveMessage: (callback: (message: Record<string, unknown>) => void) => {
					messageHandler = callback;
					return { dispose() {} };
				},
				set html(_value: string) {},
				get html() {
					return '';
				}
			},
			onDidDispose: () => ({ dispose() {} }),
			onDidChangeViewState: () => ({ dispose() {} }),
			reveal: () => {},
			dispose: () => {},
			visible: true
		};
		return fakePanel as unknown as vscode.WebviewPanel;
	};

	return {
		posted,
		send: (message) => messageHandler?.(message),
		restore: () => {
			(vscode.window as unknown as { createWebviewPanel: unknown }).createWebviewPanel = original;
		}
	};
}

export function findProjectOptionValue(html: string, projectName: string): string | undefined {
	const escaped = projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = html.match(new RegExp(`<option value="(p:\\d+)">${escaped}</option>`));
	return match?.[1];
}
