export declare function useRunAsync<T>(fn: () => Promise<T>, deps: any[]): T | undefined;
export declare function filterAsync<T>(array: T[], filter: (t: T) => Promise<boolean>): Promise<T[]>;
