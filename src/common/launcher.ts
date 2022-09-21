/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ExtensionContext, Terminal, Uri, window } from 'vscode';

import { MessageConnection } from 'vscode-jsonrpc';
import { ServiceConnection, Requests, ApiService, RAL as SyncRAL} from '@vscode/sync-api-service';

import RAL from './ral';
import PythonInstallation from './pythonInstallation';
import { ExecuteFile, RunRepl } from './messages';

export abstract class Launcher {

	private readonly exitPromise: Promise<number>;
	private exitResolveCallback!: ((value: number) => void);
	private exitRejectCallback!: ((reason: any) => void);

	private terminal: Terminal | undefined;

	public constructor() {
		this.exitPromise = new Promise((resolve, reject) => {
			this.exitResolveCallback = resolve;
			this.exitRejectCallback = reject;
		});
	}

	/**
	 * Run the Python WASM.
	 *
	 * @param context The VS Code extension context
	 * @returns A promise that completes when the WASM is executing.
	 */
	public async run(context: ExtensionContext, program?: string): Promise<void> {
		const [pythonRoot, pythonWasm] = await PythonInstallation.getConfig();

		const messageConnection = await this.createMessageConnection(context);
		messageConnection.listen();

		const syncConnection = await this.createSyncConnection(messageConnection, pythonRoot, pythonWasm);

		const apiService = new ApiService('Python WASM Execution', syncConnection, {
			exitHandler: (_rval) => {
			},
			echoName: false
		});
		const name = program !== undefined
			? `Executing ${RAL().path.basename(program)}`
			: 'Executing Python File';
		// See https://github.com/microsoft/vscode/issues/160914
		SyncRAL().timer.setTimeout(() => {
			this.terminal = window.createTerminal({ name: name, pty: apiService.getPty() });
			this.terminal.show();
		}, 250);
		syncConnection.signalReady();

		const result: Promise<number> =
			program === undefined ? messageConnection.sendRequest(RunRepl.type) : messageConnection.sendRequest(ExecuteFile.type, { file: program });

		result.
			then((rval) => { this.exitResolveCallback(rval);}).
			catch((reason) => { this.exitRejectCallback(reason); });
	}

	/**
	 * A promise that resolves then the WASM finished running.
	 *
	 * @returns The promise.
	 */
	public onExit(): Promise<number> {
		return this.exitPromise;
	}

	public terminate(): Promise<void> {
		if (this.terminal !== undefined) {
			this.terminal.sendText(`Execution terminated`, true);
		}
		return this.terminateConnection();
	}

	protected abstract createMessageConnection(context: ExtensionContext): Promise<MessageConnection>;

	protected abstract createSyncConnection(messageConnection: MessageConnection, pythonRoot: Uri, pythonWasm: string): Promise<ServiceConnection<Requests>>;

	protected abstract terminateConnection(): Promise<void>;
}