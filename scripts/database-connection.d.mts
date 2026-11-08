export type DatabaseOperation = 'migrate' | 'restore' | 'steamWrite' | 'steamRead';
export type DatabaseMode = 'development' | 'production';

export interface DatabaseUrlSummary {
	host: string;
	port: string;
	database: string;
	username: string;
}

export interface ResolvedDatabaseUrl {
	raw: string;
	url: URL;
	summary: DatabaseUrlSummary;
	mode: DatabaseMode;
	variable: string;
	expectedRole: string | undefined;
}

export interface DatabaseIdentity {
	database: string;
	role: string;
	version: string;
	rolsuper: boolean;
	rolcreatedb: boolean;
	rolcreaterole: boolean;
	rolreplication: boolean;
	rolbypassrls: boolean;
	owns_database: boolean;
	can_create_schema: boolean;
	can_write_games: boolean;
	broad_read_membership: boolean;
	broad_write_membership: boolean;
	has_role_membership: boolean;
	server_address: string | null;
}

export declare const CONNECT_TIMEOUT_MS: number;
export declare function normalizePnpmArgs(args: string[]): string[];
export declare function databaseMode(env?: NodeJS.ProcessEnv): DatabaseMode;
export declare function safeUrlSummary(raw: string): DatabaseUrlSummary;
export declare function resolveDatabaseUrl(
	operation: DatabaseOperation,
	env?: NodeJS.ProcessEnv
): ResolvedDatabaseUrl;
export declare function categorizeConnectionError(error: unknown): string;
export declare function createDatabaseClient(raw: string, applicationName: string): unknown;
export declare function preflightDatabase(
	connection: ResolvedDatabaseUrl,
	options?: { operation: DatabaseOperation; requireLocalOwner?: boolean }
): Promise<DatabaseIdentity>;
export declare function withMigrationTimeouts(raw: string): string;
export declare function dockerPortSummary(containerName?: string): {
	available: boolean;
	lines: string[];
};
