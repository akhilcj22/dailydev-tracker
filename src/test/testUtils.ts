import * as vscode from 'vscode';

/**
 * Intercepts vscode.window.createWebviewPanel so that the next modal input popup
 * (src/modal.ts's showModalInput) resolves immediately with the given value, instead of
 * waiting for a real click/keystroke inside the webview. Scope this tightly around just the
 * command call that triggers the modal, then call the returned restore function — leaving it
 * active would also hijack unrelated webview panels (like the dashboard).
 */
export function stubModalInput(value: string | undefined): () => void {
	const original = vscode.window.createWebviewPanel;

	(vscode.window as unknown as { createWebviewPanel: unknown }).createWebviewPanel = () => {
		let messageHandler: ((message: { type: string; value?: string }) => void) | undefined;
		const fakePanel = {
			webview: {
				html: '',
				postMessage: async () => true,
				onDidReceiveMessage: (callback: (message: { type: string; value?: string }) => void) => {
					messageHandler = callback;
					return { dispose() {} };
				}
			},
			onDidDispose: () => ({ dispose() {} }),
			onDidChangeViewState: () => ({ dispose() {} }),
			reveal: () => {},
			dispose: () => {},
			visible: true
		};
		queueMicrotask(() => {
			messageHandler?.(value === undefined ? { type: 'cancel' } : { type: 'submit', value });
		});
		return fakePanel as unknown as vscode.WebviewPanel;
	};

	return () => {
		(vscode.window as unknown as { createWebviewPanel: unknown }).createWebviewPanel = original;
	};
}
