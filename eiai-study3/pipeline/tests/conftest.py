"""Shared fixtures. Adds pipeline/ to the path so modules import by bare name,
matching how the CLI entry points import each other."""

import sys
from pathlib import Path

PIPELINE = Path(__file__).resolve().parent.parent
if str(PIPELINE) not in sys.path:
    sys.path.insert(0, str(PIPELINE))
