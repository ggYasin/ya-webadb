import type { Adb } from '../../adb.js';
import { DecodeUtf8Stream, GatherStringStream } from "../../stream/index.js";
import { AdbNoneSubprocessProtocol } from './legacy.js';
import { AdbShellSubprocessProtocol } from './protocol.js';
import type { AdbSubprocessProtocol, AdbSubprocessProtocolConstructor } from './types.js';

export * from './legacy.js';
export * from './protocol.js';
export * from './types.js';
export * from './utils.js';

export interface AdbSubprocessOptions {
    /**
     * A list of `AdbShellConstructor`s to be used.
     *
     * Different `AdbShell` has different capabilities, thus requires specific adaptations.
     * Check each `AdbShell`'s documentation for details.
     *
     * The first one whose `isSupported` returns `true` will be used.
     * If no `AdbShell` is supported, an error will be thrown.
     *
     * The default value is `[AdbShellProtocol, AdbLegacyShell]`.
     */
    protocols: AdbSubprocessProtocolConstructor[];
}

const DefaultOptions: AdbSubprocessOptions = {
    protocols: [AdbShellSubprocessProtocol, AdbNoneSubprocessProtocol],
};

export interface SubprocessResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export class AdbSubprocess {
    public readonly adb: Adb;

    public constructor(adb: Adb) {
        this.adb = adb;
    }

    private async createProtocol(command: string, options?: Partial<AdbSubprocessOptions>): Promise<AdbSubprocessProtocol> {
        let { protocols } = { ...DefaultOptions, ...options };

        let Constructor: AdbSubprocessProtocolConstructor | undefined;
        for (const item of protocols) {
            if (await item.isSupported(this.adb)) {
                Constructor = item;
                break;
            }
        }

        if (!Constructor) {
            throw new Error('No specified protocol is supported by the device');
        }

        return await Constructor.spawn(this.adb, command);
    }

    /**
     * Spawns the default shell in interactive mode.
     * @param options The options for creating the `AdbShell`
     * @returns A new `AdbShell` instance connecting to the spawned shell process.
     */
    public shell(options?: Partial<AdbSubprocessOptions>): Promise<AdbSubprocessProtocol> {
        return this.createProtocol('', options);
    }

    /**
     * Spawns a new process using the given `command`.
     * @param command The command to run, or an array of strings containing both command and args.
     * @param options The options for creating the `AdbShell`
     * @returns A new `AdbShell` instance connecting to the spawned process.
     */
    public spawn(command: string | string[], options?: Partial<AdbSubprocessOptions>): Promise<AdbSubprocessProtocol> {
        if (Array.isArray(command)) {
            command = command.join(' ');
        }
        return this.createProtocol(command, options);
    }

    /**
     * Spawns a new process, waits until it exits, and returns the entire output.
     * @param command The command to run
     * @param options The options for creating the `AdbShell`
     * @returns The entire output of the command
     */
    public async spawnAndWait(
        command: string | string[],
        options?: Partial<AdbSubprocessOptions>
    ): Promise<SubprocessResult> {
        const shell = await this.spawn(command, options);

        const stdout = new GatherStringStream();
        shell.stdout
            .pipeThrough(new DecodeUtf8Stream())
            .pipeThrough(stdout);

        const stderr = new GatherStringStream();
        shell.stderr
            .pipeThrough(new DecodeUtf8Stream())
            .pipeThrough(stderr);

        const exitCode = await shell.exit;

        return {
            stdout: stdout.result,
            stderr: stderr.result,
            exitCode,
        };
    }

    /**
     * Spawns a new process, waits until it exits, and returns the entire output.
     * @param command The command to run
     * @returns The entire output of the command
     */
    public async spawnAndWaitLegacy(command: string | string[]): Promise<string> {
        const { stdout } = await this.spawnAndWait(command, { protocols: [AdbNoneSubprocessProtocol] });
        return stdout;
    }
}
