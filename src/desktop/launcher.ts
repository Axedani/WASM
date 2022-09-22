/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

import { ExtensionContext, Uri } from 'vscode';

import { MessageChannel, Worker } from 'worker_threads';

import { Launcher } from '../common/launcher';

import { ServiceConnection, MessageConnection } from '@vscode/sync-api-common/node';

import { Requests } from '@vscode/sync-api-service';
import { MessageRequests } from '../common/messages';

export class DesktopLauncher extends Launcher {

	private worker: Worker | undefined;

	public constructor() {
		super();
	}

	protected async createMessageConnection(context: ExtensionContext): Promise<MessageConnection<MessageRequests, undefined>> {
		const filename = Uri.joinPath(context.extensionUri, './out/desktop/pythonWasmWorker.js').fsPath;
		this.worker = new Worker(filename);
		const channel = new MessageChannel();
		const ready = new Promise<void>((resolve, reject) => {
			if (this.worker === undefined) {
				reject(new Error(`Worker died unexpectedly.`));
				return;
			}
			this.worker.once('message', (value: string) => {
				if (value === 'ready') {
					resolve();
				} else {
					reject(new Error(`Missing ready event from worker`));
				}
			});
		});
		this.worker.postMessage(channel.port2, [channel.port2]);
		await ready;
		return new MessageConnection<MessageRequests, undefined>(channel.port1);
	}

	protected async createSyncConnection(messageConnection: MessageConnection<MessageRequests, undefined>, pythonRoot: Uri, pythonWasm: string): Promise<ServiceConnection<Requests>> {
		const channel = new MessageChannel();
		await messageConnection.sendRequest(
			'initialize',
			{ syncPort: channel.port2, pythonRoot: pythonRoot.toString(true), pythonWasm },
			[channel.port2]
		);
		return new ServiceConnection<Requests>(channel.port1);
	}

	protected async terminateConnection(): Promise<void> {
		await this.worker?.terminate();
	}
}