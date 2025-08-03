#!/usr/bin/env python3
"""
Script to remove host-related entries from log files and delete host files.
"""

import os
import glob
import shutil
from pathlib import Path


def remove_host_entries_from_log(log_file):
    """
    Remove all entries that start with '[host]' from the log file.
    Each entry is separated by empty lines.
    """
    if not os.path.exists(log_file):
        print(f"Log file {log_file} not found!")
        return False
    
    # Create backup
    backup_file = f"{log_file}.backup"
    shutil.copy2(log_file, backup_file)
    print(f"Created backup: {backup_file}")
    
    with open(log_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    filtered_lines = []
    i = 0
    
    while i < len(lines):
        line = lines[i].strip()
        
        # Check if this line starts a host entry
        if line.startswith('▶ [host]'):
            # Skip this entry by finding the next empty line or end of file
            i += 1
            while i < len(lines) and lines[i].strip() != '':
                i += 1
            # Skip the empty line too if we found one
            if i < len(lines) and lines[i].strip() == '':
                i += 1
        else:
            # Keep this line
            filtered_lines.append(lines[i])
            i += 1
    
    # Write the filtered content back
    with open(log_file, 'w', encoding='utf-8') as f:
        f.writelines(filtered_lines)
    
    print(f"Removed host entries from {log_file}")
    return True


def remove_host_files():
    """Remove all files with 'host' in their filename."""
    host_files = glob.glob('*host*')
    
    if not host_files:
        print("No files with 'host' in filename found.")
        return
    
    print("Files to be removed:")
    for file in host_files:
        print(f"  - {file}")
    
    for file in host_files:
        try:
            os.remove(file)
            print(f"Removed: {file}")
        except OSError as e:
            print(f"Error removing {file}: {e}")


def preview_host_entries(log_file):
    """Preview what host entries would be removed."""
    if not os.path.exists(log_file):
        print(f"Log file {log_file} not found!")
        return
    
    with open(log_file, 'r', encoding='utf-8') as f:
        lines = f.readlines()
    
    print("Host entries that would be removed:")
    print("-" * 50)
    
    i = 0
    entry_count = 0
    
    while i < len(lines):
        line = lines[i].strip()
        
        if line.startswith('▶ [host]'):
            entry_count += 1
            print(f"Entry {entry_count}:")
            
            # Print this entry until we hit an empty line
            while i < len(lines) and lines[i].strip() != '':
                print(lines[i].rstrip())
                i += 1
            print()  # Add empty line after entry
        else:
            i += 1
    
    print(f"Total host entries found: {entry_count}")


def main():
    log_file = "run_benchmarks.log"  # Change this to your actual log file name
    
    print("Host Entry and File Removal Script")
    print("=" * 40)
    
    # Preview what would be removed
    preview_host_entries(log_file)
    
    # Show files that would be removed
    host_files = glob.glob('*host*')
    if host_files:
        print(f"\nFiles with 'host' in filename ({len(host_files)} found):")
        for file in host_files:
            print(f"  - {file}")
    
    print("\nThis script will:")
    print(f"1. Remove host entries from log file: {log_file}")
    print("2. Remove all files with 'host' in the filename")
    
    response = input("\nContinue? (y/N): ").strip().lower()
    
    if response == 'y' or response == 'yes':
        # Remove host entries from log
        if remove_host_entries_from_log(log_file):
            print("✓ Host entries removed from log file")
        
        # Remove host files
        remove_host_files()
        print("✓ Host files removed")
        
        print("\nDone!")
    else:
        print("Aborted.")


if __name__ == "__main__":
    main()