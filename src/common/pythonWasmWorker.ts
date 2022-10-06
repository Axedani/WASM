/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */

// We can't use Uri from vscode since vscode is not available in a web worker.
import { URI } from 'vscode-uri';

import { ApiClient, BaseMessageConnection, ApiClientConnection } from '@vscode/sync-api-client';
import { WASI, Options } from '@vscode/wasm-wasi';

import { MessageRequests } from './messages';
import { Fdflags, Filetype, Rights } from '@vscode/wasm-wasi/lib/common/wasiTypes';

type MessageConnection = BaseMessageConnection<undefined, undefined, MessageRequests, undefined, unknown>;

export abstract class WasmRunner {

	private pythonRepository!: URI;
	private pythonRoot: string | undefined;
	private binary!: Uint8Array;

	constructor(private readonly connection: MessageConnection, private readonly path: { readonly join: (...paths: string[]) => string, readonly sep: string }) {
		this.connection = connection;

		connection.onRequest('initialize', async (params) => {
			this.binary = new Uint8Array(params.binary.byteLength);
			this.binary.set(new Uint8Array(params.binary));
			this.pythonRepository = URI.parse(params.pythonRepository);
			this.pythonRoot = params.pythonRoot;
		});

		connection.onRequest('executeFile', (params) => {
			return this.executePythonFile(this.createClientConnection(params.syncPort), URI.parse(params.file));
		});

		connection.onRequest('runRepl', (params) => {
			return this.runRepl(this.createClientConnection(params.syncPort));
		});
	}

	public listen(): void {
		this.connection.listen();
	}

	protected abstract createClientConnection(port: any): ApiClientConnection;

	protected async executePythonFile(clientConnection: ApiClientConnection, file: URI): Promise<number> {
		return this.run(clientConnection, file);
	}

	protected async runRepl(clientConnection: ApiClientConnection): Promise<number> {
		return this.run(clientConnection);
	}

	private async run(clientConnection: ApiClientConnection, file?: URI): Promise<number> {
		debugger;
		const apiClient = new ApiClient(clientConnection);
		const stdio = (await apiClient.serviceReady()).stdio;
		const path = this.path;
		// The is the name of the wasm to be execute (e.g. comparable to users typing it in bash)
		const name = 'python';
		const workspaceFolders = apiClient.vscode.workspace.workspaceFolders;
		const mapDir: Options['mapDir'] = [];
		let toRun: string | undefined;
		if (workspaceFolders.length === 1) {
			const folderUri = workspaceFolders[0].uri;
			mapDir.push({ name: path.join(path.sep, 'workspace'), uri: folderUri });
			if (file !== undefined) {
				if (file.toString().startsWith(folderUri.toString())) {
					toRun = path.join(path.sep, 'workspace', file.toString().substring(folderUri.toString().length));
				}
			}
		} else {
			for (const folder of workspaceFolders) {
				mapDir.push({ name: path.join(path.sep, 'workspaces', folder.name), uri: folder.uri });
			}
		}
		const pythonInstallation = this.pythonRoot === undefined
			? this.pythonRepository
			: this.pythonRepository.with({ path: path.join( this.pythonRepository.path, this.pythonRoot )});
		mapDir.push({ name: path.sep, uri: pythonInstallation });
		const mapFile: Options['mapFile'] = [];
		mapFile.push({
			name: '/debug/input',
			fileDescriptor: {
				uri: URI.from({ scheme: 'python-web-wasm-debug', path: '/input'}),
				filetype: Filetype.character_device,
				fdflags: 0,
				rights: { inheriting: Rights.CharacterDeviceInheriting, base: Rights.CharacterDeviceBase | Rights.path_open }
			}
		}, {
			name: '/debug/output',
			fileDescriptor: {
				uri: URI.from({ scheme: 'python-web-wasm-debug', path: '/output'}),
				filetype: Filetype.character_device,
				fdflags: 0,
				rights: { inheriting: Rights.CharacterDeviceInheriting, base: Rights.CharacterDeviceBase | Rights.path_open }
			}
		});
		let exitCode: number | undefined;
		const exitHandler = (rval: number): void => {
			exitCode = rval;
		};
		const wasi = WASI.create(name, apiClient, exitHandler, {
			stdio,
			mapDir,
			mapFile,
			argv: toRun !== undefined ? ['-B', '-X', 'utf8', toRun] : ['-B', '-X', 'utf8'],
			env: {
				PYTHONPATH: '/workspace:/site-packages'
			}
		});
		await this.doRun(this.binary, wasi);
		return exitCode ?? 0;
	}

	protected abstract doRun(binary: Uint8Array, wasi: WASI): Promise<void>;
}