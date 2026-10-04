#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Timestamped source-file backups with bounded retention."""

from datetime import datetime
from pathlib import Path
import shutil

MAX_BACKUPS_PER_FILE = 5


def create_backup(path, max_backups=MAX_BACKUPS_PER_FILE):
    """Copy *path* to a unique .bak timestamp file and prune older backups."""
    source = Path(path)
    if not source.is_file():
        return None

    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_%f')
    backup = source.with_name(f'{source.name}.bak.{timestamp}')
    shutil.copy2(source, backup)
    prune_backups(source, max_backups)
    return str(backup)


def prune_backups(path, max_backups=MAX_BACKUPS_PER_FILE):
    """Keep the newest backups for exactly one source file."""
    source = Path(path)
    backups = sorted(
        (candidate for candidate in source.parent.glob(f'{source.name}.bak*')
         if candidate.is_file()),
        key=lambda candidate: candidate.stat().st_mtime,
        reverse=True,
    )
    for obsolete in backups[max_backups:]:
        try:
            obsolete.unlink()
        except OSError:
            pass
