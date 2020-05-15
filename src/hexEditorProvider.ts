import * as vscode from 'vscode';
import { HexDocument } from './hexDocument';
import { disposeAll } from './dispose';
import { WebviewCollection } from './webViewCollection';
import path = require('path');
import { getNonce } from './util';
export class HexEditorProvider implements vscode.CustomReadonlyEditorProvider<HexDocument> {
    public static register(context: vscode.ExtensionContext) : vscode.Disposable {
        return vscode.window.registerCustomEditorProvider2(
            HexEditorProvider.viewType,
            new HexEditorProvider(context),
            {
                supportsMultipleEditorsPerDocument: false
            }
        ) 
    }

    private static readonly viewType = 'hexEditor.hexedit';

    private readonly webviews = new WebviewCollection();

    constructor(
		private readonly _context: vscode.ExtensionContext
    ) { }
    
    async openCustomDocument(
        uri: vscode.Uri,
        openContext: vscode.CustomDocumentOpenContext,
        token: vscode.CancellationToken
    ): Promise<HexDocument> {
        const document = await HexDocument.create(uri, openContext.backupId, {
            getFileData: async() => {
                const webviewsForDocument: any = Array.from(this.webviews.get(document.uri));
				if (!webviewsForDocument.length) {
					throw new Error('Could not find webview to save for');
				}
                const panel = webviewsForDocument[0];
                const response = await this.postMessageWithResponse<{ data: number[] }>(panel, 'getFileData', {});
				return new Uint8Array(response.data);
            }
        });
        // We don't need any listeners right now because the document is readonly, but this will help to have when we enable edits
        const listeners: vscode.Disposable[] = [];

        document.onDidDispose(() => disposeAll(listeners));

        return document;
    }

    async resolveCustomEditor(
		document: HexDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		// Add the webview to our internal set of active webviews
		this.webviews.add(document.uri, webviewPanel);

		// Setup initial content for the webview
		webviewPanel.webview.options = {
			enableScripts: true,
		};
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

		webviewPanel.webview.onDidReceiveMessage(e => this.onMessage(document, e));

		// Wait for the webview to be properly ready before we init
		webviewPanel.webview.onDidReceiveMessage(e => {
			if (e.type === 'ready') {
				this.postMessage(webviewPanel, 'init', {
					fileSize: document.filesize,
					value: document.documentData,
					html: document.documentData.length === document.filesize ? this.getBodyHTML() : undefined
				});
			}
		});

		webviewPanel.webview.onDidReceiveMessage(async e => {
			if (e.type == 'open-anyways') {
				await document.openAnyways();
				this.postMessage(webviewPanel, 'init', {
					fileSize: document.filesize,
					value: document.documentData,
					html: this.getBodyHTML()
				})
			}
		});
    }
    /**
	 * Get the static HTML used for in our editor's webviews.
	 * Document size is needed to decide if the document is being opened
	*/
	private getHtmlForWebview(webview: vscode.Webview): string {
		// Local path to script and css for the webview
		const scriptUri = webview.asWebviewUri(vscode.Uri.file(
			path.join(this._context.extensionPath, 'media', 'hexEdit.js')
		));
		const styleUri = webview.asWebviewUri(vscode.Uri.file(
			path.join(this._context.extensionPath, 'media', 'hexEdit.css')
		));

		// Use a nonce to whitelist which scripts can be run
		const nonce = getNonce();

		return /* html */`
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
				Use a content security policy to only allow loading images from https or from our extension directory,
				and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} blob:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<link href="${styleUri}" rel="stylesheet" />
				<script nonce="${nonce}" src="${scriptUri}" defer></script>

				<title>Hex Editor</title>
			</head>
			<body>
			</body>
			</html>`;
	}

	private getBodyHTML() {
		return `
		<div class="column" id="data-inspector">
			<div class="header">Data Inspector</div>
			<div class="grid-container">
				<div class="grid-item">
					<label for="binary8">8 bit Binary</label>
				</div>
				<div class="grid-item">
					<input type="text" autocomplete="off" spellcheck="off" id="binary8" readonly/>
				</div>
				<div class="grid-item">
					<label for="int8">Int8</label>
				</div>
				<div class="grid-item">
					<input type="text" autocomplete="off" spellcheck="off" id="int8" readonly/>
				</div>
				<div class="grid-item">
					<label for="uint8">UInt8</label>
				</div>
				<div class="grid-item">
					<input type="text" autocomplete="off" spellcheck="off" id="uint8" readonly/>
				</div>
			</div>
		</div>
		<div class="column left" id="hexaddr">
			<div class="header">Memory Offset </div>
		</div>
		<div class="column middle" id="hexbody">
			<div class="header">
				<span>00</span><span>01</span><span>02</span><span>03</span><span>04</span><span>05</span><span>06</span><span>07</span><span>08</span><span>09</span><span>0A</span><span>0B</span><span>0C</span><span>0D</span><span>0E</span><span>0F</span>
			</div>
		</div>
		<div class="column right" id="ascii">
			<div class="header">Decoded Text</div>
		</div>`;
	}
	
    private _requestId = 1;
	private readonly _callbacks = new Map<number, (response: any) => void>();

	private postMessageWithResponse<R = unknown>(panel: vscode.WebviewPanel, type: string, body: any): Promise<R> {
		const requestId = this._requestId++;
		const p = new Promise<R>(resolve => this._callbacks.set(requestId, resolve));
		panel.webview.postMessage({ type, requestId, body });
		return p;
	}

	private postMessage(panel: vscode.WebviewPanel, type: string, body: any): void {
		panel.webview.postMessage({ type, body });
	}

	private onMessage(document: HexDocument, message: any) {
		console.log(message);
		switch(message.type) {
			case 'edit':
				vscode.window.showInformationMessage('This editor is currently readonly.');
				return;
		}
	}
}
