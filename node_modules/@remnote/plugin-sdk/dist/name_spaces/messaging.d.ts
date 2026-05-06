import { InternalCallMethod, NamespaceBase } from './base';
/**
 * # Messaging Namespace
 *
 * The API Messaging namespace.
 */
export declare class MessagingNamespace extends NamespaceBase {
    /** @hidden */
    constructor(_call: InternalCallMethod);
    /**
     * Broadcast a message to any listener within the current plugin.
     */
    broadcast: (message: any) => Promise<void>;
}
