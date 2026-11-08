export type DatabaseOperation =
	'setup' | 'doctor' | 'migrate' | 'restore' | 'steamWrite' | 'steamRead' | 'backup';
export interface DatabaseUrlSummary {
	host: string;
	port: string;
	database: string;
	username: string;
}

export interface ResolvedDatabaseUrl {
	raw: string;
	url: URL;
	options: {
		host: string;
		port: number;
		database: string;
		user: string;
		password: string;
		connectionTimeoutMillis: number;
		query_timeout: number;
		statement_timeout: number;
		application_name: string;
	};
	summary: DatabaseUrlSummary;
	variable: string;
	testIdentity?: { markerTable: string; markerValue: string };
}

export interface DatabaseIdentity {
	database: string;
	role: string;
	version: string;
	can_create_database_objects: boolean;
	can_use_public: boolean;
	can_create_public: boolean;
	drizzle_schema_exists: boolean;
	can_create_migration_history: boolean;
	can_write_games: boolean;
	can_read_games: boolean;
	server_address: string | null;
}

export declare const CONNECT_TIMEOUT_MS: number;
export declare function normalizePnpmArgs(args: string[]): string[];
export declare function safeUrlSummary(raw: string): DatabaseUrlSummary;
export declare function resolveDatabaseUrl(
	operation: DatabaseOperation,
	env?: NodeJS.ProcessEnv
): ResolvedDatabaseUrl;
export declare function categorizeConnectionError(error: unknown): string;
export declare function missingOperationPermissions(
	identity: Partial<DatabaseIdentity>,
	operation: DatabaseOperation
): string[];
export declare function createDatabaseClient(
	connection: ResolvedDatabaseUrl | string,
	applicationName: string
): unknown;
export declare function preflightDatabase(
	connection: ResolvedDatabaseUrl,
	options?: { operation: DatabaseOperation; requireLocalOwner?: boolean }
): Promise<DatabaseIdentity>;
export declare function withMigrationTimeouts(raw: string): string;
export declare function dockerPortSummary(containerName?: string): {
	available: boolean;
	lines: string[];
};
