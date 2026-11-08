#!/usr/bin/env python3
"""Prepare the VapourDB database and its least-privilege runtime roles."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = Path(os.environ.get("VAPOURDB_ENV_FILE", ROOT / ".env"))
DATABASE = "vapourdb"
MAINTENANCE_DATABASE = "postgres"
WEB_ROLE = "vapourdb_web"
DEV_ROLE = "vapourdb_dev"
IMPORTER_ROLE = "vapourdb_importer"
MIGRATION_ROLE = "vapourdb_migrator"
DATABASE_IDENTITIES = {
    "vapourdb": ("vapourdb", "vapourdb_web", "vapourdb_importer", "vapourdb_migrator"),
    "vapourdb_test": ("vapourdb", "vapourdb_web", "vapourdb_importer", "vapourdb_migrator"),
    "tuxgg": ("tuxgg", "tuxgg_web", "tuxgg_importer", "tuxgg_migrator"),
    "tuxgg_test": ("tuxgg", "tuxgg_web", "tuxgg_importer", "tuxgg_migrator"),
}

TABLES = (
    "games",
    "user",
    "session",
    "account",
    "verification",
    "native_reports",
    "user_devices",
)
SEQUENCES: tuple[str, ...] = ()
WEB_PRIVILEGES = {
    "games": "SELECT",
    "user": "SELECT, INSERT, UPDATE",
    "session": "SELECT, INSERT, UPDATE, DELETE",
    "account": "SELECT, INSERT, UPDATE, DELETE",
    "verification": "SELECT, INSERT, UPDATE, DELETE",
    "native_reports": "SELECT",
    "user_devices": "SELECT, INSERT, UPDATE, DELETE",
}
NATIVE_REPORT_INSERT_COLUMNS = (
    "id",
    "app_id",
    "author_id",
    "verdict",
    "platform",
    "proton_version",
    "proton_variant",
    "custom_proton_version",
    "distribution",
    "kernel",
    "cpu",
    "gpu",
    "gpu_vendor",
    "graphics_driver",
    "ram",
    "launch_options",
    "performance_notes",
    "known_issues",
    "content",
    "gpu_driver_detail",
    "device_id",
    "device_name_snapshot",
)
IMPORTER_PRIVILEGES = {
    "games": "SELECT, INSERT, UPDATE",
}


def grant_native_report_insert_columns(cur, roles) -> None:
    """Grant only the report fields accepted from web submissions."""
    from psycopg import sql

    cur.execute(
        "SELECT attname FROM pg_attribute "
        "WHERE attrelid = to_regclass(%s) AND attnum > 0 AND NOT attisdropped "
        "ORDER BY attnum",
        ("public.native_reports",),
    )
    available_columns = [row[0] for row in cur.fetchall()]
    if not available_columns:
        return

    all_columns = sql.SQL(", ").join(sql.Identifier(column) for column in available_columns)
    revoke_columns = sql.SQL(
        "INSERT ({columns}), UPDATE ({columns}), REFERENCES ({columns})"
    ).format(columns=all_columns)
    for role in roles:
        cur.execute(
            sql.SQL("REVOKE {privileges} ON TABLE public.native_reports FROM {role}").format(
                privileges=revoke_columns, role=sql.Identifier(role)
            )
        )

    allowed_columns = [
        column for column in NATIVE_REPORT_INSERT_COLUMNS if column in available_columns
    ]
    if allowed_columns:
        insert_columns = sql.SQL(", ").join(sql.Identifier(column) for column in allowed_columns)
        for role in roles:
            cur.execute(
                sql.SQL("GRANT INSERT ({columns}) ON TABLE public.native_reports TO {role}").format(
                    columns=insert_columns, role=sql.Identifier(role)
                )
            )


def read_env_file() -> dict[str, str]:
    values: dict[str, str] = {}
    if not ENV_FILE.exists():
        return values
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def url_for_database(
    source: str, database: str, username: str | None = None, password: str | None = None
) -> str:
    parts = urlsplit(source)
    if not parts.scheme.startswith("postgres") or not parts.hostname:
        raise ValueError("Database URLs must be PostgreSQL URLs with a host.")
    userinfo = ""
    if username is not None:
        userinfo = quote(username, safe="")
        if password is not None:
            userinfo += ":" + quote(password, safe="")
        userinfo += "@"
    elif parts.username is not None:
        userinfo = quote(parts.username, safe="")
        if parts.password is not None:
            userinfo += ":" + quote(parts.password, safe="")
        userinfo += "@"
    host = f"[{parts.hostname}]" if ":" in parts.hostname else parts.hostname
    if parts.port:
        host += f":{parts.port}"
    return urlunsplit((parts.scheme, userinfo + host, f"/{database}", parts.query, ""))


def connect(url: str):
    try:
        import psycopg
    except ImportError as exc:
        raise RuntimeError(
            "Install database setup dependencies first: python -m pip install -r scripts/requirements.txt"
        ) from exc
    return psycopg.connect(url, autocommit=True, connect_timeout=5)


def _role_exists(cur, role: str) -> bool:
    cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,))
    return cur.fetchone() is not None


def _verify_admin_database(conn) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT current_database()")
        if cur.fetchone()[0] != MAINTENANCE_DATABASE:
            raise RuntimeError("PGADMIN_URL must connect to the postgres maintenance database.")


def _create_login_role(cur, role: str, password: str) -> None:
    from psycopg import sql

    cur.execute(
        sql.SQL(
            "CREATE ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT "
            "NOREPLICATION NOBYPASSRLS PASSWORD {}"
        ).format(sql.Identifier(role), sql.Literal(password))
    )


def _validate_role(cur, role: str, database: str = DATABASE) -> None:
    cur.execute(
        "SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls "
        "FROM pg_roles WHERE rolname = %s",
        (role,),
    )
    attributes = cur.fetchone()
    if attributes is None:
        raise RuntimeError(f"The {role} role does not exist.")
    if any(attributes):
        raise RuntimeError(f"The {role} role has PostgreSQL administrator attributes.")
    cur.execute(
        "SELECT EXISTS (SELECT 1 FROM pg_auth_members "
        "WHERE member = (SELECT oid FROM pg_roles WHERE rolname = %s))",
        (role,),
    )
    if cur.fetchone()[0]:
        raise RuntimeError(f"The {role} role has role memberships; remove them before setup.")
    cur.execute(
        "SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname <> %s "
        "AND datdba = (SELECT oid FROM pg_roles WHERE rolname = %s))",
        (database, role),
    )
    if cur.fetchone()[0]:
        raise RuntimeError(f"The {role} role owns a database outside VapourDB.")


def _url_for_role(
    file_values: dict[str, str],
    role: str,
    env_key: str,
    cur,
    database: str = DATABASE,
) -> str:
    environment_url = os.environ.get(env_key)
    file_url = file_values.get(env_key)
    existing_url = environment_url or file_url
    if not existing_url:
        raise RuntimeError(f"Set {env_key} to the existing {role} connection for production setup.")
    parts = urlsplit(existing_url)
    if parts.username != role:
        raise RuntimeError(f"{env_key} must use the dedicated {role} role.")
    if not _role_exists(cur, role):
        if parts.password is None:
            raise RuntimeError(f"{env_key} must include the new {role} password when provisioning that role.")
        _create_login_role(cur, role, unquote(parts.password))
    return url_for_database(existing_url, database)


def _prepare_database(admin_url: str, database_exists: bool, database: str, roles: tuple[str, str, str]) -> None:
    from psycopg import sql

    with connect(admin_url) as conn:
        _verify_admin_database(conn)
        with conn.cursor() as cur:
            for role in roles:
                if _role_exists(cur, role):
                    _validate_role(cur, role, database)
            if not database_exists:
                cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(database)))
            for role in roles:
                cur.execute(
                    sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                        sql.Identifier(database), sql.Identifier(role)
                    )
                )
            cur.execute(
                sql.SQL("GRANT CREATE ON DATABASE {} TO {}").format(
                    sql.Identifier(database), sql.Identifier(roles[2])
                )
            )
            cur.execute(
                sql.SQL("REVOKE CREATE ON DATABASE {} FROM PUBLIC").format(sql.Identifier(database))
            )
            for role in roles[:2]:
                cur.execute(
                    sql.SQL("REVOKE CREATE ON DATABASE {} FROM {}").format(
                        sql.Identifier(database), sql.Identifier(role)
                    )
                )


def _grant_runtime_access(database_admin_url: str, database: str, roles: tuple[str, str, str]) -> None:
    from psycopg import sql

    web_role, importer_role, migration_role = roles
    revoke_roles = [web_role, importer_role]
    with connect(database_admin_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            if cur.fetchone()[0] != database:
                raise RuntimeError(f"Refusing schema changes outside the {database} database.")
            cur.execute(
                "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = %s",
                (database,),
            )
            database_owner = cur.fetchone()[0]
            if database_owner in (web_role, importer_role):
                raise RuntimeError("A runtime role owns the VapourDB database; transfer ownership before setup.")

            cur.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
            cur.execute(sql.SQL("ALTER SCHEMA public OWNER TO {}").format(sql.Identifier(migration_role)))
            cur.execute("SELECT to_regnamespace('drizzle')")
            if cur.fetchone()[0] is not None:
                cur.execute(sql.SQL("ALTER SCHEMA drizzle OWNER TO {}").format(sql.Identifier(migration_role)))
                cur.execute("SELECT to_regclass('drizzle.__drizzle_migrations')")
                if cur.fetchone()[0] is not None:
                    cur.execute(
                        sql.SQL("ALTER TABLE drizzle.__drizzle_migrations OWNER TO {}").format(
                            sql.Identifier(migration_role)
                        )
                    )
            for role in roles:
                cur.execute(sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(sql.Identifier(role)))
                cur.execute(
                    sql.SQL("REVOKE CREATE ON SCHEMA public FROM {}").format(sql.Identifier(role))
                )
            cur.execute(sql.SQL("GRANT CREATE ON SCHEMA public TO {}").format(sql.Identifier(migration_role)))

            # Existing VapourDB objects move to the migration role so later migrations can alter them.
            for table in TABLES:
                cur.execute("SELECT to_regclass(%s)", (f"public.{table}",))
                if cur.fetchone()[0] is not None:
                    cur.execute(
                        sql.SQL("ALTER TABLE public.{} OWNER TO {}").format(
                        sql.Identifier(table), sql.Identifier(migration_role)
                        )
                    )
            for sequence in SEQUENCES:
                cur.execute("SELECT to_regclass(%s)", (f"public.{sequence}",))
                if cur.fetchone()[0] is not None:
                    cur.execute(
                        sql.SQL("ALTER SEQUENCE public.{} OWNER TO {}").format(
                        sql.Identifier(sequence), sql.Identifier(migration_role)
                        )
                    )

            # Keep the migration role's owner privileges: PostgreSQL runs foreign-key checks
            # with the referenced table owner's rights. Revoking the owner's SELECT/UPDATE
            # privileges breaks Better Auth's account/session references to public.user.
            for table in TABLES:
                cur.execute("SELECT to_regclass(%s)", (f"public.{table}",))
                if cur.fetchone()[0] is None:
                    continue
                for role in revoke_roles:
                    cur.execute(
                        sql.SQL("REVOKE ALL PRIVILEGES ON TABLE public.{} FROM {}").format(
                            sql.Identifier(table), sql.Identifier(role)
                        )
                    )
                if table in WEB_PRIVILEGES:
                    cur.execute(
                        sql.SQL("GRANT " + WEB_PRIVILEGES[table] + " ON TABLE public.{} TO {}").format(
                            sql.Identifier(table), sql.Identifier(web_role)
                        )
                    )
                if table == "native_reports":
                    grant_native_report_insert_columns(cur, (web_role,))
                if table in IMPORTER_PRIVILEGES:
                    cur.execute(
                        sql.SQL("GRANT " + IMPORTER_PRIVILEGES[table] + " ON TABLE public.{} TO {}").format(
                            sql.Identifier(table), sql.Identifier(importer_role)
                        )
                    )

            for sequence in SEQUENCES:
                cur.execute("SELECT to_regclass(%s)", (f"public.{sequence}",))
                if cur.fetchone()[0] is None:
                    continue
                for role in revoke_roles:
                    cur.execute(
                        sql.SQL("REVOKE ALL PRIVILEGES ON SEQUENCE public.{} FROM {}").format(
                            sql.Identifier(sequence), sql.Identifier(role)
                        )
                    )
                cur.execute(
                    sql.SQL("GRANT USAGE, SELECT ON SEQUENCE public.{} TO {}").format(
                        sql.Identifier(sequence), sql.Identifier(importer_role)
                    )
                )

            # Grant only known tables here. Run db:grant after each future migration to
            # keep new tables out of both runtime roles until their access is reviewed.


def resolve_identity(values: dict[str, str]) -> tuple[str, tuple[str, str, str]]:
    """Keep an existing legacy .env usable until its database is safely cut over."""
    candidates = []
    for key in ("MIGRATION_DATABASE_URL", "DATABASE_URL", "IMPORTER_DATABASE_URL"):
        raw = os.environ.get(key) or values.get(key)
        if raw:
            candidates.append((key, urlsplit(raw).path.rstrip("/").split("/")[-1]))
    identities = {DATABASE_IDENTITIES[name] for _, name in candidates if name in DATABASE_IDENTITIES}
    if len(identities) > 1:
        raise RuntimeError("Configured database URLs mix legacy and VapourDB identities.")
    if identities:
        database, web, importer, migrator = next(iter(identities))
        return database, (web, importer, migrator)
    return "vapourdb", ("vapourdb_web", "vapourdb_importer", "vapourdb_migrator")


def _local_database_url() -> str:
    values = read_env_file()
    raw = os.environ.get("DATABASE_URL") or values.get("DATABASE_URL")
    if not raw:
        raise RuntimeError("Set DATABASE_URL to the local vapourdb_dev connection in the ignored .env file.")
    parts = urlsplit(raw)
    if not parts.scheme.startswith("postgres") or not parts.hostname:
        raise RuntimeError("DATABASE_URL must be a PostgreSQL URL with a host.")
    if parts.hostname.lower() not in ("localhost", "127.0.0.1", "::1"):
        raise RuntimeError("Local setup accepts only a loopback database host; Docker must publish a host port.")
    if parts.path.rstrip("/").split("/")[-1] != "vapourdb":
        raise RuntimeError("Local setup only verifies the vapourdb database. Legacy tuxgg data is never selected.")
    if unquote(parts.username or "") != DEV_ROLE:
        if unquote(parts.username or "") == WEB_ROLE:
            raise RuntimeError(
                "DATABASE_URL uses the restricted vapourdb_web role. Keep it for the app and provision a separate vapourdb_dev owner role for local development."
            )
        raise RuntimeError("Local DATABASE_URL must use the dedicated vapourdb_dev role.")
    return raw


def _bootstrap_local_database(target_url: str) -> None:
    from getpass import getpass
    from psycopg import sql

    target = urlsplit(target_url)
    if target.password is None:
        raise RuntimeError("DATABASE_URL must contain the intended vapourdb_dev password before bootstrap.")
    admin_url = os.environ.get("VAPOURDB_BOOTSTRAP_ADMIN_URL")
    if not admin_url:
        if not sys.stdin.isatty():
            raise RuntimeError(
                "The database or role is missing. Set VAPOURDB_BOOTSTRAP_ADMIN_URL temporarily and rerun pnpm db:setup -- --bootstrap."
            )
        admin_url = getpass("One-time PostgreSQL maintenance URL (input hidden): ")
    admin = urlsplit(admin_url)
    target_port = target.port or 5432
    admin_port = admin.port or 5432
    if (
        not admin.scheme.startswith("postgres")
        or admin.hostname != target.hostname
        or admin_port != target_port
        or admin.path.rstrip("/").split("/")[-1] != "postgres"
        or admin.hostname.lower() not in ("localhost", "127.0.0.1", "::1")
    ):
        raise RuntimeError(
            "Bootstrap needs a loopback maintenance URL for the postgres database on the same host and published port as DATABASE_URL."
        )

    database_exists = False
    role_exists = False
    with connect(admin_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database(), r.rolsuper, r.rolcreaterole, r.rolcreatedb FROM pg_roles r WHERE r.rolname = current_user")
            row = cur.fetchone()
            if not row or row[0] != MAINTENANCE_DATABASE:
                raise RuntimeError("Bootstrap maintenance login must connect to PostgreSQL's postgres database.")
            if not (row[1] or row[2]) or not (row[1] or row[3]):
                raise RuntimeError("Bootstrap login needs permission to create roles and databases; no workaround was attempted.")
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DATABASE,))
            database_exists = cur.fetchone() is not None
            role_exists = _role_exists(cur, DEV_ROLE)
            if database_exists and not role_exists:
                raise RuntimeError(
                    "vapourdb exists without vapourdb_dev. Refusing to take ownership of an existing database; review it and provision the owner role deliberately."
                )
            if role_exists:
                _validate_role(cur, DEV_ROLE, DATABASE)
            elif database_exists:
                raise RuntimeError("Refusing to add a new owner role to the existing vapourdb database.")
            else:
                _create_login_role(cur, DEV_ROLE, unquote(target.password))
            if not database_exists:
                cur.execute(
                    sql.SQL("CREATE DATABASE {} OWNER {}").format(
                        sql.Identifier(DATABASE), sql.Identifier(DEV_ROLE)
                    )
                )
    print("One-time local bootstrap completed. No existing database or role password was changed.")


def _verify_local_database(target_url: str) -> None:
    with connect(target_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT current_database(), current_user, r.rolsuper, r.rolcreatedb, r.rolcreaterole, "
                "r.rolreplication, r.rolbypassrls, d.datdba = r.oid, "
                "has_schema_privilege(current_user, 'public', 'CREATE'), "
                "EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid) "
                "FROM pg_roles r CROSS JOIN pg_database d "
                "WHERE r.rolname = current_user AND d.datname = current_database()"
            )
            row = cur.fetchone()
            if not row or row[0] != DATABASE or row[1] != DEV_ROLE:
                raise RuntimeError("The configured credentials did not reach vapourdb as vapourdb_dev.")
            if any(row[2:7]) or row[9]:
                raise RuntimeError("vapourdb_dev has administrator attributes; remove them before local setup.")
            if not row[7] or not row[8]:
                raise RuntimeError(
                    "vapourdb_dev must own the local vapourdb database and be able to create objects in public."
                )


def run(grant_only: bool, production: bool = False, bootstrap: bool = False) -> None:
    global DATABASE, WEB_ROLE, IMPORTER_ROLE, MIGRATION_ROLE
    file_values = read_env_file()
    if not production:
        if grant_only:
            raise RuntimeError("db:grant is for production or multi-role installations, not single-role local development.")
        target_url = _local_database_url()
        if bootstrap:
            try:
                _verify_local_database(target_url)
                print("Local vapourdb setup is already complete. No bootstrap changes were made.")
                return
            except Exception as exc:
                if getattr(exc, "sqlstate", None) not in ("28P01", "28000", "3D000"):
                    raise RuntimeError(
                        "Could not reach the local database. Run pnpm db:doctor before attempting bootstrap."
                    ) from None
            _bootstrap_local_database(target_url)
        try:
            _verify_local_database(target_url)
        except Exception as exc:
            if getattr(exc, "sqlstate", None) == "28P01":
                raise RuntimeError("PostgreSQL authentication failed for DATABASE_URL; verify the local role password.") from None
            if getattr(exc, "sqlstate", None) == "3D000":
                raise RuntimeError("The vapourdb database is missing. Use pnpm db:setup -- --bootstrap when authorized.") from None
            if getattr(exc, "sqlstate", None) == "42501":
                raise RuntimeError("PostgreSQL privileges are insufficient for the local development role.") from None
            raise RuntimeError(
                "Could not verify local PostgreSQL. Check Docker published-port reachability with pnpm db:doctor."
            ) from None
        print("Local vapourdb setup verified. DATABASE_URL was not changed; no data or passwords were modified.")
        return

    DATABASE, roles = resolve_identity(file_values)
    WEB_ROLE, IMPORTER_ROLE, MIGRATION_ROLE = roles
    admin_url = os.environ.get("PGADMIN_URL") or file_values.get("PGADMIN_URL")
    if not admin_url:
        raise RuntimeError("Set PGADMIN_URL to a PostgreSQL administrator connection in .env.")
    if urlsplit(admin_url).path.rstrip("/").split("/")[-1] != MAINTENANCE_DATABASE:
        raise RuntimeError("PGADMIN_URL must point to the postgres maintenance database.")

    if grant_only:
        with connect(admin_url) as conn:
            _verify_admin_database(conn)
            with conn.cursor() as cur:
                if not _role_exists(cur, WEB_ROLE) or not _role_exists(cur, IMPORTER_ROLE) or not _role_exists(cur, MIGRATION_ROLE):
                    raise RuntimeError("Run database setup first so the web, importer, and migration roles exist.")
                for role in (WEB_ROLE, IMPORTER_ROLE, MIGRATION_ROLE):
                    if _role_exists(cur, role):
                        _validate_role(cur, role, DATABASE)
                cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DATABASE,))
                if cur.fetchone() is None:
                    raise RuntimeError(f"The {DATABASE} database does not exist; run setup without --grant-only first.")
        _grant_runtime_access(url_for_database(admin_url, DATABASE), DATABASE, roles)
        print("VapourDB-only runtime grants refreshed for the web and importer roles.")
        return

    runtime_roles = roles
    with connect(admin_url) as conn:
        _verify_admin_database(conn)
        with conn.cursor() as cur:
            role_urls = {
                WEB_ROLE: _url_for_role(file_values, WEB_ROLE, "DATABASE_URL", cur, DATABASE),
                IMPORTER_ROLE: _url_for_role(
                    file_values, IMPORTER_ROLE, "IMPORTER_DATABASE_URL", cur, DATABASE
                ),
                MIGRATION_ROLE: _url_for_role(
                    file_values, MIGRATION_ROLE, "MIGRATION_DATABASE_URL", cur, DATABASE
                ),
            }
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DATABASE,))
            database_exists = cur.fetchone() is not None

    _prepare_database(admin_url, database_exists, DATABASE, runtime_roles)
    _grant_runtime_access(url_for_database(admin_url, DATABASE), DATABASE, runtime_roles)
    for role, env_key in (
        (WEB_ROLE, "DATABASE_URL"),
        (IMPORTER_ROLE, "IMPORTER_DATABASE_URL"),
        (MIGRATION_ROLE, "MIGRATION_DATABASE_URL"),
    ):
        url = role_urls.get(role) or file_values.get(env_key) or os.environ.get(env_key)
        if not url:
            raise RuntimeError(f"No connection URL was available for the {role} role.")
        try:
            with connect(url_for_database(url, DATABASE)) as role_conn:
                with role_conn.cursor() as role_cur:
                    role_cur.execute("SELECT current_database(), current_user")
                    if role_cur.fetchone() != (DATABASE, role):
                        raise RuntimeError(f"The {role} credentials did not connect to the expected database and role.")
        except Exception as exc:
            raise RuntimeError(f"The {role} database URL could not be verified; setup did not change its password.") from exc
    print("Production database roles and grants are ready. No .env file or existing role password was changed.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--grant-only", action="store_true", help="refresh least-privilege grants after migrations")
    parser.add_argument("--production", action="store_true", help="run advanced multi-role production provisioning")
    parser.add_argument("--bootstrap", action="store_true", help="create only a missing local role/database after explicit admin input")
    cli_args = sys.argv[1:]
    # pnpm forwards the explicit separator in `pnpm db:setup -- --bootstrap`.
    if cli_args[:1] == ["--"]:
        cli_args = cli_args[1:]
    args = parser.parse_args(cli_args)
    try:
        if args.bootstrap and args.production:
            raise RuntimeError("Local --bootstrap cannot be combined with --production.")
        if args.grant_only and not args.production:
            raise RuntimeError("Use pnpm db:grant:production for production/multi-role grants.")
        run(args.grant_only, args.production, args.bootstrap)
        return 0
    except RuntimeError as exc:
        print(f"Database setup failed: {exc}", file=sys.stderr)
        return 1
    except Exception as exc:
        code = getattr(exc, "sqlstate", None)
        category = (
            "PostgreSQL authentication failed" if code in ("28P01", "28000") else
            "PostgreSQL database does not exist" if code == "3D000" else
            "PostgreSQL privileges are insufficient" if code == "42501" else
            "PostgreSQL connection failed"
        )
        print(f"Database setup failed: {category}. Connection details and credentials were redacted.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
