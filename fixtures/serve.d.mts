export declare const SITES_DIR: string;
export declare const SITE_NAMES: readonly ["clean", "messy", "woocommerce"];
/** Start the fixture server. Pass port 0 for a random free port (tests). */
export declare function startFixtureServer(options?: { port?: number; host?: string }): Promise<{ url: string; close: () => Promise<void> }>;
