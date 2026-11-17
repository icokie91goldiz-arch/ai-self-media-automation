#!/bin/zsh
set -e
cd "$(dirname "$0")"
/usr/bin/python3 scripts/manage.py demo
