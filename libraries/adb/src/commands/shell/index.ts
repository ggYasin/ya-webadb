import { once } from "@yume-chan/event";
import type { Adb } from '../../adb';
import { decodeUtf8 } from "../../utils";
import { AdbLegacyShell } from './legacy';
import { AdbShellProtocol } from './protocol';
import type { AdbShell, AdbShellConstructor } from './types';

export * from './legacy';
export * from './protocol';
export * from './types';
export * from './utils';

export interface AdbChildProcessOptions {
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
    shells: AdbShellConstructor[];
}

const DefaultOptions: AdbChildProcessOptions = {
    shells: [AdbShellProtocol, AdbLegacyShell],
};

export interface ChildProcessResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export class AdbChildProcess {
    public readonly adb: Adb;

    public constructor(adb: Adb) {
        this.adb = adb;
    }

    private async createShell(command: string, options?: Partial<AdbChildProcessOptions>): Promise<AdbShell> {
        let { shells } = { ...DefaultOptions, ...options };

        let shell: AdbShellConstructor | undefined;
        for (const item of shells) {
            if (await item.isSupported(this.adb)) {
                shell = item;
                break;
            }
        }

        if (!shell) {
            throw new Error('No specified shell is supported by the device');
        }

        return await shell.spawn(this.adb, command);
    }

    /**
     * Spawns the default shell in interactive mode.
     * @param options The options for creating the `AdbShell`
     * @returns A new `AdbShell` instance connecting to the spawned shell process.
     */
    public shell(options?: Partial<AdbChildProcessOptions>): Promise<AdbShell> {
        return this.createShell('', options);
    }

    /**
     * Spawns a new process using the given `command`.
     * @param command The command to run, or an array of strings containing both command and args.
     * @param options The options for creating the `AdbShell`
     * @returns A new `AdbShell` instance connecting to the spawned process.
     */
    public spawn(command: string | string[], options?: Partial<AdbChildProcessOptions>): Promise<AdbShell> {
        if (Array.isArray(command)) {
            command = command.join(' ');
        }
        return this.createShell(command, options);
    }

    /**
     * Spawns a new process, waits until it exits, and returns the entire output.
     * @param command The command to run
     * @param args List of command arguments
     * @returns The entire output of the command
     */
    public async spawnAndWait(command: string | string[], options?: Partial<AdbChildProcessOptions>): Promise<ChildProcessResult> {
        const shell = await this.spawn(command, options);
        // Optimization: rope (concat strings) is faster than `[].join('')`
        let stdout = '';
        let stderr = '';
        shell.onStdout(buffer => stdout += decodeUtf8(buffer));
        shell.onStderr(buffer => stderr += decodeUtf8(buffer));
        const exitCode = await once(shell.onExit);
        return {
            stdout,
            stderr,
            exitCode,
        };
    }

    public async spawnAndWaitLegacy(command: string | string[]): Promise<string> {
        const { stdout } = await this.spawnAndWait(command, { shells: [AdbLegacyShell] });
        return stdout;
    }
}
