/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
/// <reference path="./typings.d.ts" />

import * as _path from 'path';
const path = _path.posix;
import { MessagePort, parentPort } from 'worker_threads';

import { ClientConnection, Requests, MessageConnection } from '@vscode/sync-api-common/node';
import { WASI } from '@vscode/wasm-wasi/node';

import { WasmRunner } from '../common/pythonWasmWorker';
import { MessageRequests } from '../common/messages';

if (parentPort === null) {
	process.exit();
}

class WebWasmRunner extends WasmRunner {
	constructor(port: MessagePort) {
		super(new MessageConnection<undefined, undefined, MessageRequests, undefined>(port), path);
	}

	protected createClientConnection(port: MessagePort): ClientConnection<Requests> {
		return new ClientConnection<Requests>(port);
	}

	protected async doRun(binary: Uint8Array, wasi: WASI): Promise<void> {
		const { instance } = await WebAssembly.instantiate(binary, {
			wasi_snapshot_preview1: wasi
		});
		wasi.initialize(instance);
		(instance.exports._start as Function)();
	}
}

parentPort.on('message', (port: MessagePort) => {
	const runner = new WebWasmRunner(port);
	runner.listen();
	parentPort?.postMessage('ready');
});