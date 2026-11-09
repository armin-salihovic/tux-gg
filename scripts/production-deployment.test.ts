import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string) => readFileSync(path.join(root, relativePath), 'utf8');

describe('production deployment packaging', () => {
	const compose = read('deploy/production/compose.yml');
	const envExample = read('deploy/production/env.example');
	const dockerfile = read('Dockerfile');
	const deployScript = read('deploy/production/deploy.sh');
	const nginx = read('deploy/production/nginx.conf');
	const runbook = read('deploy/production/README.md');
	const ci = read('.github/workflows/ci.yml');
	const release = read('.github/workflows/release-production.yml');

	it('uses the existing PostgreSQL network without defining or publishing a database', () => {
		expect(compose).toContain('name: vapourdb');
		expect(compose).toMatch(
			/production_internal:\s*\n\s+external: true\s*\n\s+name: production_internal/
		);
		expect(compose).not.toMatch(/^\s{2}postgres:\s*$/m);
		expect(compose).not.toMatch(/(?:5432:5432|published:\s*["']?5432)/);
		expect(compose).toContain("'127.0.0.1:3000:3000'");
		expect(compose).toContain('format: raw');
		expect(compose).toContain('sha-${VAPOURDB_IMAGE_REVISION:?');
		expect(compose).toContain('ghcr.io/armin-salihovic/vapourdb');
		expect(compose).toContain("'http://127.0.0.1:3000/healthz'");
	});

	it('keeps production settings and secrets in a VPS-owned config template', () => {
		for (const setting of [
			'NODE_ENV=production',
			'HOST=0.0.0.0',
			'PORT=3000',
			'ORIGIN=https://vapourdb.com',
			'BETTER_AUTH_URL=https://vapourdb.com',
			'PUBLIC_SITE_URL=https://vapourdb.com',
			'DB_CONNECTION=pgsql',
			'DB_HOST=postgres',
			'DB_PORT=5432',
			'DB_DATABASE=vapourdb',
			'DB_USERNAME=vapourdb'
		])
			expect(envExample).toContain(setting);
		expect(envExample).toContain('DB_PASSWORD=replace-');
		expect(envExample).toContain('BETTER_AUTH_SECRET=replace-');
		expect(dockerfile).toContain('FROM dependencies AS migration');
		expect(dockerfile).toContain('scripts/db_migrate.mjs');
		expect(dockerfile).toContain('scripts/restore_games.mjs');
		expect(dockerfile).toContain('drizzle.config.ts');
		expect(dockerfile).toContain('COPY --chown=node:node drizzle ./drizzle');
		expect(dockerfile).toContain('ENTRYPOINT ["node", "scripts/db_migrate.mjs"]');
		expect(dockerfile).toContain('USER node');
	});

	it('runs and verifies migrations before replacing the app', () => {
		const migrationRun = deployScript.indexOf('--profile migrations run --rm --no-deps migrate');
		const appUpdate = deployScript.indexOf(' up -d --no-deps --force-recreate app');
		expect(migrationRun).toBeGreaterThanOrEqual(0);
		expect(appUpdate).toBeGreaterThan(migrationRun);
		expect(deployScript).toContain('production-postgres-1');
		expect(deployScript).toContain('production_internal');
		expect(deployScript).toContain('Compose project name must be vapourdb');
		expect(deployScript).toContain('VPS runtime environment file must have mode 0600');
		expect(deployScript).toContain('org.opencontainers.image.revision');
		expect(deployScript).toContain('config --quiet');
		expect(deployScript).toContain('http://127.0.0.1:3000/healthz');
		expect(deployScript).not.toContain('db:setup');
		expect(deployScript).not.toContain('docker system prune');
		expect(deployScript).not.toContain('compose down');
	});

	it('configures an independent apex HTTPS vhost and loopback proxy', () => {
		expect(nginx).toContain('server_name vapourdb.com;');
		expect(nginx).toMatch(
			/server\s*\{\s*listen 443 ssl;[\s\S]*?\n\tinclude \/etc\/nginx\/cloudflare-realip\.conf;\n\treal_ip_header CF-Connecting-IP;\n\treal_ip_recursive on;/
		);
		expect(nginx).toContain('include /etc/nginx/cloudflare-realip.conf;');
		expect(nginx).toContain('real_ip_header CF-Connecting-IP;');
		expect(nginx).toContain('real_ip_recursive on;');
		expect(nginx).not.toMatch(/^\s*set_real_ip_from\s+/m);
		expect(nginx).toContain('proxy_pass http://127.0.0.1:3000;');
		expect(nginx).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
		expect(nginx).not.toMatch(/proxy_set_header X-Forwarded-For \$http_x_forwarded_for/i);
		expect(nginx).toContain('ssl_certificate /etc/ssl/cloudflare/vapourdb.com.pem;');
		expect(nginx).not.toContain('elecparts.app');
	});

	it('documents the recovery trade-off without a backup gate', () => {
		expect(runbook).toContain(
			'can permanently lose VapourDB accounts, sessions, reports, devices, and game catalog'
		);
		expect(runbook).toContain('A Docker volume provides persistence, not a backup.');
		expect(runbook).toContain('Backups are not a deployment prerequisite');
		expect(runbook).toContain('A prior image or release tag does not reverse database migrations.');
		expect(runbook).toContain('matching-40-character-commit-sha-from-that-run');
		expect(runbook).not.toMatch(/pg_dump|age identity|backup-before-deploy|vapourdb-backups/i);
	});

	it('keeps push and pull-request checks separate from immutable tag releases', () => {
		expect(ci).toContain('pull_request:');
		expect(ci).toMatch(/push:\s*\n\s+branches: \[main\]/);
		expect(ci).toContain('workflow_call:');
		expect(ci).not.toContain('release-production.yml');
		expect(release).toMatch(/push:\s*\n\s+tags: \['v\*'\]/);
		expect(release).not.toContain('pull_request:');
		expect(release).toContain('uses: ./.github/workflows/ci.yml');
		expect(release).toContain('ref: ${{ github.sha }}');
		expect(release).toContain('git merge-base --is-ancestor');
		expect(release).toContain('needs: [validate-release, ci]');
		expect(release).toContain('Refuse to replace published release tags');
		expect(release).toContain('Could not verify that image tag is absent');
		expect(release).toContain('sha-${{ github.sha }}');
		expect(release).toContain('ghcr.io/armin-salihovic/vapourdb:${{ github.ref_name }}');
		expect(release).toContain('target: migration');
		expect(release).toContain('packages: write');
		expect(release).toContain('environment: production');
		expect(release).toContain('group: vapourdb-production');
		expect(release).toContain('StrictHostKeyChecking=yes');
		expect(release).toContain('UserKnownHostsFile=');
		expect(release).toContain('DEPLOY_SSH_PRIVATE_KEY');
		expect(release).toContain('DEPLOY_KNOWN_HOSTS');
		expect(release).not.toContain('BETTER_AUTH_SECRET');
		expect(release).not.toContain('DB_PASSWORD');
		expect(release).not.toContain('STEAM_API_KEY');
		expect(release).not.toContain(':latest');
		expect(dockerfile).not.toMatch(/COPY .*\.env/);
		expect(dockerfile).not.toContain('BETTER_AUTH_SECRET');
	});
});
