import type { ValueOrPromise } from "@yume-chan/struct";
import type { Adb } from "../../adb.js";
import type { AdbSocket } from "../../socket/index.js";
import type { ReadableStream, WritableStream } from "../../stream/index.js";

export interface AdbSubprocessProtocol {
    /**
     * A WritableStream that writes to the `stdin` pipe.
     */
    readonly stdin: WritableStream<Uint8Array>;

    /**
     * The `stdout` pipe of the process.
     */
    readonly stdout: ReadableStream<Uint8Array>;

    /**
     * The `stderr` pipe of the process.
     *
     * Note: Some `AdbShell` doesn't separate `stdout` and `stderr`,
     * All output will be sent to `stdout`.
     */
    readonly stderr: ReadableStream<Uint8Array>;

    /**
     * A `Promise` that resolves to the exit code of the process.
     *
     * Note: Some `AdbShell` doesn't support exit code,
     * They will always resolve with `0`.
     */
    readonly exit: Promise<number>;

    /**
     * Resizes the current shell.
     *
     * Some `AdbShell`s may not support resizing and will always ignore calls to this method.
     */
    resize(rows: number, cols: number): ValueOrPromise<void>;

    /**
     * Kills the current process.
     */
    kill(): ValueOrPromise<void>;
}

export interface AdbSubprocessProtocolConstructor {
    /** Returns `true` if the `adb` instance supports this shell */
    isSupported(adb: Adb): ValueOrPromise<boolean>;

    /** Creates a new `AdbShell` using the specified `Adb` and `command` */
    spawn(adb: Adb, command: string): ValueOrPromise<AdbSubprocessProtocol>;

    /** Creates a new `AdbShell` by attaching to an exist `AdbSocket` */
    new(socket: AdbSocket): AdbSubprocessProtocol;
}
