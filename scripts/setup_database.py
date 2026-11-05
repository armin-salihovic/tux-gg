#!/usr/bin/env python3
"""Prepare the TuxGG database and its least-privilege runtime roles."""

from __future__ import annotations

import argparse
import os
import secrets
import sys
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env"
DATABASE = "tuxgg"
MAINTENANCE_DATABASE = "postgres"
WEB_ROLE = "tuxgg_web"
IMPORTER_ROLE = "tuxgg_importer"
MIGRATION_ROLE = "tuxgg_migrator"
LEGACY_ROLE = "tuxgg_app"

TABLES = (
    "games",
    "reports",
    "import_batches",
    "compatibility_summaries",
    "user",
    "session",
    "account",
    "verification",
    "native_reports",
    "user_devices",
    "__drizzle_migrations",
)
SEQUENCES = ("reports_id_seq", "import_batches_id_seq")
WEB_PRIVILEGES = {
    "games": "SELECT",
    "reports": "SELECT",
    "import_batches": "SELECT",
    "compatibility_summaries": "SELECT",
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
    "reports": "SELECT, INSERT, UPDATE",
    "import_batches": "SELECT, INSERT, UPDATE",
    "compatibility_summaries": "SELECT, INSERT, UPDATE, DELETE",
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


def write_env_file(values: dict[str, str]) -> None:
    lines: list[str] = []
    seen: set[str] = set()
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else ""
            if key in values:
                lines.append(f"{key}={values[key]}")
                seen.add(key)
            else:
                lines.append(line)
    for key, value in values.items():
        if key not in seen:
            lines.append(f"{key}={value}")
    ENV_FILE.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


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
            "Install importer dependencies first: python -m pip install -r importer/requirements.txt"
        ) from exc
    return psycopg.connect(url, autocommit=True)


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


def _validate_role(cur, role: str) -> None:
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
        (DATABASE, role),
    )
    if cur.fetchone()[0]:
        raise RuntimeError(f"The {role} role owns a database outside TuxGG.")


def _url_for_role(
    admin_url: str,
    file_values: dict[str, str],
    new_values: dict[str, str],
    role: str,
    env_key: str,
    cur,
) -> str:
    from psycopg import sql

    environment_url = os.environ.get(env_key)
    file_url = file_values.get(env_key)
    existing_url = (
        environment_url
        if environment_url and urlsplit(environment_url).username == role
        else file_url
        if file_url and urlsplit(file_url).username == role
        else environment_url or file_url
    )
    if _role_exists(cur, role):
        if not existing_url:
            raise RuntimeError(
                f"The {role} role already exists, but {env_key} is unavailable to verify its password."
            )
        if urlsplit(existing_url).username != role:
            raise RuntimeError(f"{env_key} must use the dedicated {role} role after it exists.")
        return url_for_database(existing_url, DATABASE)

    password = secrets.token_urlsafe(36)
    _create_login_role(cur, role, password)
    new_values[env_key] = url_for_database(admin_url, DATABASE, role, password)
    return new_values[env_key]


def _prepare_database(admin_url: str, database_exists: bool) -> None:
    from psycopg import sql

    with connect(admin_url) as conn:
        _verify_admin_database(conn)
        with conn.cursor() as cur:
            for role in (WEB_ROLE, IMPORTER_ROLE, MIGRATION_ROLE, LEGACY_ROLE):
                if _role_exists(cur, role):
                    _validate_role(cur, role)
            if not database_exists:
                cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(DATABASE)))
            for role in (WEB_ROLE, IMPORTER_ROLE, MIGRATION_ROLE):
                cur.execute(
                    sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                        sql.Identifier(DATABASE), sql.Identifier(role)
                    )
                )
            cur.execute(
                sql.SQL("GRANT CREATE ON DATABASE {} TO {}").format(
                    sql.Identifier(DATABASE), sql.Identifier(MIGRATION_ROLE)
                )
            )
            cur.execute(
                sql.SQL("REVOKE CREATE ON DATABASE {} FROM PUBLIC").format(sql.Identifier(DATABASE))
            )
            for role in (WEB_ROLE, IMPORTER_ROLE, LEGACY_ROLE):
                if _role_exists(cur, role):
                    cur.execute(
                        sql.SQL("REVOKE CREATE ON DATABASE {} FROM {}").format(
                            sql.Identifier(DATABASE), sql.Identifier(role)
                        )
                    )


def _grant_runtime_access(database_admin_url: str, legacy_exists: bool) -> None:
    from psycopg import sql

    roles = [WEB_ROLE, IMPORTER_ROLE, MIGRATION_ROLE]
    if legacy_exists:
        roles.append(LEGACY_ROLE)
    revoke_roles = [role for role in roles if role != MIGRATION_ROLE]
    with connect(database_admin_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            if cur.fetchone()[0] != DATABASE:
                raise RuntimeError("Refusing schema changes outside the tuxgg database.")
            cur.execute(
                "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = %s",
                (DATABASE,),
            )
            database_owner = cur.fetchone()[0]
            if database_owner in (WEB_ROLE, IMPORTER_ROLE, LEGACY_ROLE):
                raise RuntimeError("A runtime role owns the TuxGG database; transfer ownership before setup.")

            cur.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
            cur.execute(sql.SQL("ALTER SCHEMA public OWNER TO {}").format(sql.Identifier(MIGRATION_ROLE)))
            for role in roles:
                cur.execute(sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(sql.Identifier(role)))
                cur.execute(
                    sql.SQL("REVOKE CREATE ON SCHEMA public FROM {}").format(sql.Identifier(role))
                )
            cur.execute(
                sql.SQL("GRANT CREATE ON SCHEMA public TO {}").format(sql.Identifier(MIGRATION_ROLE))
            )

            # Existing TuxGG objects move to the migration role so later migrations can alter them.
            for table in TABLES:
                cur.execute("SELECT to_regclass(%s)", (f"public.{table}",))
                if cur.fetchone()[0] is not None:
                    cur.execute(
                        sql.SQL("ALTER TABLE public.{} OWNER TO {}").format(
                            sql.Identifier(table), sql.Identifier(MIGRATION_ROLE)
                        )
                    )
            for sequence in SEQUENCES:
                cur.execute("SELECT to_regclass(%s)", (f"public.{sequence}",))
                if cur.fetchone()[0] is not None:
                    cur.execute(
                        sql.SQL("ALTER SEQUENCE public.{} OWNER TO {}").format(
                            sql.Identifier(sequence), sql.Identifier(MIGRATION_ROLE)
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
                    for role in (WEB_ROLE, LEGACY_ROLE) if legacy_exists else (WEB_ROLE,):
                        cur.execute(
                            sql.SQL("GRANT " + WEB_PRIVILEGES[table] + " ON TABLE public.{} TO {}").format(
                                sql.Identifier(table), sql.Identifier(role)
                            )
                        )
                if table == "native_reports":
                    grant_native_report_insert_columns(
                        cur,
                        (WEB_ROLE, LEGACY_ROLE) if legacy_exists else (WEB_ROLE,),
                    )
                if table in IMPORTER_PRIVILEGES:
                    cur.execute(
                        sql.SQL("GRANT " + IMPORTER_PRIVILEGES[table] + " ON TABLE public.{} TO {}").format(
                            sql.Identifier(table), sql.Identifier(IMPORTER_ROLE)
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
                        sql.Identifier(sequence), sql.Identifier(IMPORTER_ROLE)
                    )
                )

            # Grant only known tables here. Run db:grant after each future migration to
            # keep new tables out of both runtime roles until their access is reviewed.


def run(grant_only: bool) -> None:
    file_values = read_env_file()
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
                legacy_exists = _role_exists(cur, LEGACY_ROLE)
                for role in (WEB_ROLE, IMPORTER_ROLE, MIGRATION_ROLE, LEGACY_ROLE):
                    if _role_exists(cur, role):
                        _validate_role(cur, role)
                cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DATABASE,))
                if cur.fetchone() is None:
                    raise RuntimeError("The tuxgg database does not exist; run setup without --grant-only first.")
        _grant_runtime_access(url_for_database(admin_url, DATABASE), legacy_exists)
        print("TuxGG-only runtime grants refreshed for the web and importer roles.")
        return

    new_values: dict[str, str] = {"PGADMIN_URL": admin_url}
    with connect(admin_url) as conn:
        _verify_admin_database(conn)
        with conn.cursor() as cur:
            roles = {
                WEB_ROLE: _url_for_role(admin_url, file_values, new_values, WEB_ROLE, "DATABASE_URL", cur),
                IMPORTER_ROLE: _url_for_role(
                    admin_url, file_values, new_values, IMPORTER_ROLE, "IMPORTER_DATABASE_URL", cur
                ),
                MIGRATION_ROLE: _url_for_role(
                    admin_url, file_values, new_values, MIGRATION_ROLE, "MIGRATION_DATABASE_URL", cur
                ),
            }
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DATABASE,))
            database_exists = cur.fetchone() is not None

    _prepare_database(admin_url, database_exists)
    legacy_exists = False
    with connect(admin_url) as conn:
        with conn.cursor() as cur:
            legacy_exists = _role_exists(cur, LEGACY_ROLE)
            if legacy_exists:
                _validate_role(cur, LEGACY_ROLE)

    _grant_runtime_access(url_for_database(admin_url, DATABASE), legacy_exists)
    for role, env_key in (
        (WEB_ROLE, "DATABASE_URL"),
        (IMPORTER_ROLE, "IMPORTER_DATABASE_URL"),
        (MIGRATION_ROLE, "MIGRATION_DATABASE_URL"),
    ):
        url = new_values.get(env_key) or file_values.get(env_key) or os.environ.get(env_key)
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
        new_values[env_key] = url_for_database(url, DATABASE)
        if env_key == "DATABASE_URL":
            parts = urlsplit(url)
            host = f"[{parts.hostname}]" if parts.hostname and ":" in parts.hostname else (parts.hostname or "")
            if parts.port:
                host += f":{parts.port}"
            if parts.hostname in ("localhost", "127.0.0.1", "::1"):
                host = f"host.docker.internal:{parts.port}" if parts.port else "host.docker.internal"
            userinfo = ""
            if parts.username is not None:
                userinfo = quote(parts.username, safe="")
                if parts.password is not None:
                    userinfo += ":" + quote(parts.password, safe="")
                userinfo += "@"
            new_values["DATABASE_URL_DOCKER"] = urlunsplit(
                (parts.scheme, userinfo + host, f"/{DATABASE}", parts.query, "")
            )
    write_env_file(new_values)
    print("TuxGG database roles are ready. Connection URLs were saved to the ignored .env file and were not displayed.")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--grant-only", action="store_true", help="refresh least-privilege grants after migrations")
    args = parser.parse_args()
    try:
        run(args.grant_only)
        return 0
    except Exception:
        print(
            "Database setup failed. Check the PostgreSQL maintenance connection, role state, and TuxGG database; credentials and connection details are not printed.",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
