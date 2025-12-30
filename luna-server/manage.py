#!/usr/bin/env python
import os
import sys

def main():
    print("Starting Django...")
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "luna_server.settings")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError("Django not found") from exc
    execute_from_command_line(sys.argv)

if __name__ == "__main__":
    main()

