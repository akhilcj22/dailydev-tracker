import * as vscode from 'vscode';

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
	const now = new Date();
	const pad = (n: number) => n.toString().padStart(2, '0');
	return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
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

export function findProjectOptionValue(html: string, projectName: string): string | undefined {
	const escaped = projectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const match = html.match(new RegExp(`<option value="(p:\\d+)">${escaped}</option>`));
	return match?.[1];
}
