// cspell: ignore ponyfill

import { AbortSignal } from "web-streams-polyfill";
// TODO: import the ponyfill instead (as a library should do)
export * from 'web-streams-polyfill';

/** A controller object that allows you to abort one or more DOM requests as and when desired. */
export interface AbortController {
    /**
     * Returns the AbortSignal object associated with this object.
     */

    readonly signal: AbortSignal;
    /**
     * Invoking this method will set this object's AbortSignal's aborted flag and signal to any observers that the associated activity is to be aborted.
     */
    abort(): void;
}

export let AbortController: {
    prototype: AbortController;
    new(): AbortController;
};

({ AbortController } = globalThis as any);
