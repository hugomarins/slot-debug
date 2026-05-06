import { InternalCallMethod, NamespaceBase } from './base';
/**
 * # Storage Namespace
 *
 * The API Storage namespace.
 */
export declare class StorageNamespace extends NamespaceBase {
    /** @hidden */
    constructor(_call: InternalCallMethod);
    /**
     * Set an item in session storage (unsynced, does not persist).
     */
    setSession: (key: string, value: any) => Promise<void>;
    /**
     * Get an item from session storage (unsynced, does not persist).
     */
    getSession: <T = unknown>(key: string | undefined) => Promise<T | undefined>;
    /**
     * Set an item in synced storage (synced, does persist).
     */
    setSynced: (key: string, value: any) => Promise<void>;
    /**
     * Get an item from synced storage (synced, does persist).
     */
    getSynced: <T = unknown>(key: string | undefined) => Promise<T | undefined>;
    /**
     * Set an item in local storage (unsynced, does persist).
     */
    setLocal: (key: string, value: any) => Promise<void>;
    /**
     * Get an item from local storage (unsynced, does persist).
     */
    getLocal: <T = unknown>(key: string | undefined) => Promise<T | undefined>;
}
