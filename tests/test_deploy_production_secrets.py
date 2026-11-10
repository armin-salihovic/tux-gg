import re
import shutil
import subprocess
from pathlib import Path

import pytest


DEPLOY_SCRIPT = Path(__file__).resolve().parents[1] / "deploy/production/deploy.sh"


def _secret_validation_program() -> str:
    deploy_script = DEPLOY_SCRIPT.read_text(encoding="utf-8")
    require_secret = re.search(r"(?ms)^require_secret\(\) \{(.*?)^\}", deploy_script)
    assert require_secret is not None, "require_secret() was not found in deploy.sh"

    awk_command = re.search(
        r"""(?ms)^[ \t]*if ! awk -F= -v key="\$key" '\n(?P<program>.*?)^[ \t]*' "\$RUNTIME_ENV_FILE"; then$""",
        require_secret.group(1),
    )
    assert awk_command is not None, "require_secret() AWK program was not found in deploy.sh"
    return awk_command.group("program")


@pytest.mark.parametrize(
    ("value", "is_valid"),
    [
        ("a-valid-production-secret=with-equals", True),
        ("", False),
        ("replace-with-existing-vapourdb-role-password", False),
        ("replace-with-a-new-production-secret", False),
        ("<replace-this>", False),
        ("valid-secret\nDB_PASSWORD=duplicate", False),
    ],
)
def test_production_secret_validation_uses_portable_mawk(
    tmp_path: Path, value: str, is_valid: bool
) -> None:
    mawk = shutil.which("mawk")
    assert mawk is not None, "mawk must be installed to run production secret validation tests"

    env_file = tmp_path / "vapourdb.env"
    env_file.write_text(f"DB_PASSWORD={value}\n", encoding="utf-8")

    result = subprocess.run(
        [mawk, "-F=", "-v", "key=DB_PASSWORD", _secret_validation_program(), str(env_file)],
        check=False,
        capture_output=True,
        text=True,
    )

    assert (result.returncode == 0) is is_valid, result.stderr
