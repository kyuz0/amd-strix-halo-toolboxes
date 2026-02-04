#!/usr/bin/env python3
import sys
import os
import shutil
import tempfile
import subprocess
import time
import signal
from pathlib import Path

# --- Configuration & Defaults ---
SCRIPT_DIR = Path(__file__).parent.resolve()
DEFAULT_TOOLBOX = "rocm7-nightlies"
TOOLBOX_IMAGES = {
    "rocm6_4_4": "llama-rocm-6.4.4",

    "rocm7-nightlies": "llama-rocm7-nightlies",
    "vulkan_amdvlk": "llama-vulkan-amdvlk",
    "vulkan_radv": "llama-vulkan-radv",
}

MODES = ["llama-server", "llama-cli", "llama-bench"]
DEFAULT_MODE = "llama-server"

# Default RPC Hosts
DEFAULT_HOSTS = [
    ("192.168.100.11", True),
    ("192.168.100.12", True),
    ("192.168.100.13", True),
]

REMOTE_PORT = os.getenv("REMOTE_PORT", "22")
RPC_PORT = os.getenv("RPC_PORT", "50052")
LOCAL_HOST_PORT = "8080"


# --- Helper Functions ---

def check_dependencies():
    if not shutil.which("dialog"):
        print("Error: 'dialog' is required. Please install it (e.g., sudo apt-get install dialog).")
        sys.exit(1)

def run_dialog(args):
    """Runs dialog and returns stderr (selection), and exit code."""
    with tempfile.NamedTemporaryFile(mode="w+") as tf:
        cmd = ["dialog"] + args
        try:
            res = subprocess.run(cmd, stderr=tf, check=False) # Check False to handle exit codes
            tf.seek(0)
            return tf.read().strip(), res.returncode
        except Exception:
            return None, 1

def show_msg(title, msg):
    run_dialog(["--title", title, "--msgbox", msg, "10", "60"])

# --- Custom File Picker ---

def get_directory_contents(path):
    try:
        if not os.path.isdir(path):
            return [], []
        
        entries = os.listdir(path)
        dirs = []
        files = []
        
        for e in entries:
            full_path = os.path.join(path, e)
            if os.path.isdir(full_path):
                dirs.append(e)
            elif e.endswith(".gguf"): # Filter for GGUF
                files.append(e)
                
        dirs.sort()
        files.sort()
        return dirs, files
    except PermissionError:
        return [], []

def custom_file_picker(start_path):
    current_path = os.path.abspath(start_path)
    if not os.path.isdir(current_path):
        current_path = os.getcwd()
        
    while True:
        dirs, files = get_directory_contents(current_path)
        
        menu_items = []
        
        # Parent directory option
        if current_path != "/":
            menu_items.extend(["..", "Parent Directory"])
            
        # Directories
        for d in dirs:
            menu_items.extend([d + "/", "<DIR>"])
            
        # Files
        for f in files:
            menu_items.extend([f, "<GGUF>"])
            
        if not menu_items:
            menu_items.extend([".", "Empty Directory"])

        # Title shows current path truncated if needed
        pretty_path = current_path
        if len(pretty_path) > 50:
            pretty_path = "..." + pretty_path[-47:]

        selection, code = run_dialog([
            "--title", f"Select GGUF File",
            "--backtitle", f"Current: {pretty_path}",
            "--menu", "Navigate directories and select a .gguf file:", "20", "70", "12",
            *menu_items
        ])
        
        if code != 0: # Cancel/Escape
            return None

        clean_selection = selection.strip()
        
        if clean_selection == "..":
            current_path = os.path.dirname(current_path)
        elif clean_selection.endswith("/"):
            # Enter directory
            dir_name = clean_selection[:-1] # Remove slash
            current_path = os.path.join(current_path, dir_name)
        elif clean_selection == ".":
            pass # Stay here
        else:
            # File selected
            return os.path.join(current_path, clean_selection)

# --- Main Logic ---

class AppState:
    def __init__(self):
        self.model_path = ""
        self.toolbox = DEFAULT_TOOLBOX
        self.mode = DEFAULT_MODE
        # List of [ip, enabled]
        self.hosts = [list(h) for h in DEFAULT_HOSTS]
        self.context_size = None # None means default (do not pass -c)

    @property
    def active_hosts(self):
        return [h[0] for h in self.hosts if h[1]]

def select_model(state):
    start_path = state.model_path if state.model_path else os.getcwd()
    if os.path.isfile(start_path):
        start_path = os.path.dirname(start_path)
        
    selection = custom_file_picker(start_path)
    if selection:
        state.model_path = selection

def select_toolbox(state):
    menu_items = []
    for key in TOOLBOX_IMAGES.keys():
        menu_items.extend([key, TOOLBOX_IMAGES[key]])
    
    selection, code = run_dialog([
        "--title", "Select Toolbox",
        "--menu", "Choose the container environment:", "15", "60", "8",
        *menu_items
    ])
    if code == 0 and selection:
        state.toolbox = selection

def select_mode(state):
    menu_items = []
    for m in MODES:
        menu_items.extend([m, ""])
        
    selection, code = run_dialog([
        "--title", "Select Execution Mode",
        "--menu", "Choose how to run the model:", "12", "50", "5",
        *menu_items
    ])
    if code == 0 and selection:
        state.mode = selection

def select_context(state):
    current = str(state.context_size) if state.context_size else ""
    selection, code = run_dialog([
        "--title", "Context Size",
        "--inputbox", "Enter context size (e.g. 4096, 8192).\nLeave empty for model default:", "10", "60",
        current
    ])
    if code == 0:
        val = selection.strip()
        if val.isdigit():
            state.context_size = int(val)
        else:
            state.context_size = None

def add_server(state):
    selection, code = run_dialog([
        "--title", "Add Server",
        "--inputbox", "Enter new server IP address:", "10", "50"
    ])
    if code == 0:
        ip = selection.strip()
        if ip:
            # Default to enabled
            state.hosts.append([ip, True])

def remove_server(state):
    items = []
    for i, (ip, enabled) in enumerate(state.hosts):
        items.extend([str(i), ip])
    
    if not items:
        show_msg("Info", "No servers to remove.")
        return

    selection, code = run_dialog([
        "--title", "Remove Server",
        "--menu", "Select server to remove:", "15", "50", "5",
        *items
    ])
    
    if code == 0 and selection:
        idx = int(selection)
        if 0 <= idx < len(state.hosts):
            del state.hosts[idx]

def edit_server(state):
    items = []
    for i, (ip, enabled) in enumerate(state.hosts):
        items.extend([str(i), ip])
    
    if not items:
        show_msg("Info", "No servers to edit.")
        return

    selection, code = run_dialog([
        "--title", "Edit Server",
        "--menu", "Select server to edit:", "15", "50", "5",
        *items
    ])
    
    if code == 0 and selection:
        idx = int(selection)
        if 0 <= idx < len(state.hosts):
            current_ip = state.hosts[idx][0]
            new_ip, code2 = run_dialog([
                "--title", "Edit Server IP",
                "--inputbox", "Enter new IP address:", "10", "50",
                current_ip
            ])
            if code2 == 0:
                clean_ip = new_ip.strip()
                if clean_ip:
                    state.hosts[idx][0] = clean_ip

def toggle_servers(state):
    # checklist: item tag, item string, status (on/off)
    items = []
    for i, (ip, enabled) in enumerate(state.hosts):
        status = "on" if enabled else "off"
        items.extend([str(i), ip, status])
    
    if not items:
        show_msg("Info", "No servers to configure. Add some first.")
        return

    selection_str, code = run_dialog([
        "--title", "Toggle Active Servers",
        "--checklist", "Select active servers (Space to toggle):", "15", "50", "5",
        *items
    ])
    
    if code == 0:
        # Reset all to False first
        for h in state.hosts:
            h[1] = False
            
        if selection_str:
            # e.g. "0 2"
            indices = [int(x.strip('"')) for x in selection_str.split()]
            for idx in indices:
                if 0 <= idx < len(state.hosts):
                    state.hosts[idx][1] = True

def configure_servers(state):
    while True:
        menu = [
            "1", "Toggle Active Servers",
            "2", "Add Server",
            "3", "Remove Server",
            "4", "Edit Server",
            "5", "Back"
        ]
        
        selection, code = run_dialog([
            "--title", "Manage Remote Servers",
            "--menu", "Choose an action:", "15", "50", "5",
            *menu
        ])
        
        if code != 0 or selection == "5":
            break
            
        if selection == "1":
            toggle_servers(state)
        elif selection == "2":
            add_server(state)
        elif selection == "3":
            remove_server(state)
        elif selection == "4":
            edit_server(state)

def run_distributed(state):
    if not state.model_path or not os.path.exists(state.model_path):
        show_msg("Error", f"Model file not found:\n{state.model_path}")
        return

    if not state.active_hosts:
        show_msg("Error", "No remote servers selected.")
        return

    image = TOOLBOX_IMAGES[state.toolbox]
    active_ips = state.active_hosts
    
    # Clear screen for execution output
    subprocess.run(["clear"])
    print(f"=== Starting Distributed Run ===")
    print(f"Model:   {state.model_path}")
    print(f"Toolbox: {state.toolbox} ({image})")
    print(f"Mode:    {state.mode}")
    print(f"Context: {state.context_size if state.context_size else 'Default'}")
    print(f"Hosts:   {active_ips}")
    print("--------------------------------")

    remote_pids = []
    
    def cleanup():
        print("\nCleaning up...")
        for i, ip in enumerate(active_ips):
            if i < len(remote_pids):
                pid = remote_pids[i]
                if pid:
                    print(f"Killing remote RPC on {ip} (PID: {pid})...")
                    subprocess.run(
                        ["ssh", "-p", REMOTE_PORT, ip, f"kill -9 {pid} 2>/dev/null || true; pkill -9 -f rpc-server || true"], 
                        stderr=subprocess.DEVNULL
                    )

    # Register signal handler for cleanup
    def signal_handler(sig, frame):
        cleanup()
        sys.exit(0)
    signal.signal(signal.SIGINT, signal_handler)

    try:
        rpc_arg_parts = []
        
        # 1. Start Remote RPC Servers
        for ip in active_ips:
            print(f"-> Starting RPC server on {ip}...")
            
            # Using bash heredoc via ssh to start background process and print PID
            # We assume 'toolbox' command exists on remote
            cmd_str = f"""
            set -euo pipefail
            pkill -9 -f rpc-server || true
            nohup toolbox run -c {image} -- rpc-server -H 0.0.0.0 -p {RPC_PORT} -c > /tmp/rpc-server-{ip}.log 2>&1 < /dev/null &
            echo $!
            """
            
            res = subprocess.run(
                ["ssh", "-p", REMOTE_PORT, ip, "bash -s"],
                input=cmd_str, text=True, capture_output=True
            )
            
            if res.returncode != 0:
                print(f"[ERROR] SSH failed for {ip}: {res.stderr}")
                cleanup()
                return

            pid = res.stdout.strip()
            # Basic validation
            if not pid.isdigit():
                 lines = pid.splitlines()
                 if lines and lines[-1].isdigit():
                     pid = lines[-1]
                 else:
                    print(f"[ERROR] Invalid PID returned from {ip}: {pid}")
                    cleanup()
                    return
                
            remote_pids.append(pid)
            print(f"   PID: {pid}")

            # Wait for port check
            print(f"   Waiting for port {RPC_PORT}...", end="", flush=True)
            ready = False
            for _ in range(30):
                import socket
                s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
                s.settimeout(1)
                try:
                    s.connect((ip, int(RPC_PORT)))
                    s.close()
                    ready = True
                    print(" OK.")
                    break
                except:
                    time.sleep(1)
            
            if not ready:
                print(" TIMEOUT.")
                print(f"[ERROR] Failed to connect to {ip}:{RPC_PORT}")
                cleanup()
                return
            
            rpc_arg_parts.append(f"{ip}:{RPC_PORT}")

        rpc_arg = ",".join(rpc_arg_parts)
        print(f"All servers ready. RPC Arg: {rpc_arg}")
        print(f"Starting Local {state.mode}...")
        print("--------------------------------")

        # 2. Run Local Executable
        # Base arguments for all modes
        base_args = [
            "toolbox", "run", "-c", image, "--",
            state.mode,
            "-m", state.model_path,
            "--rpc", rpc_arg
        ]

        if state.mode == "llama-server":
             # Llama Server specific
             extra_args = [
                 "--no-mmap", 
                 "-fa", "1",
                 "--host", "0.0.0.0",
                 "--port", LOCAL_HOST_PORT
             ]
             if state.context_size:
                 extra_args.extend(["-c", str(state.context_size)])

        elif state.mode == "llama-cli":
             # Llama CLI specific (interactive or basic run)
             # User requested -mmp 0 and -fa 1
             extra_args = [
                 "--no-mmap",
                 "-fa", "1",
                 "-cnv", # Conversation mode seems appropriate for CLI
                 "-p", "You are a helpful assistant." 
             ]
             if state.context_size:
                 extra_args.extend(["-c", str(state.context_size)])

        elif state.mode == "llama-bench":
             # Llama Bench specific
             # User requested -mmp 0 and -fa 1 (Note: llama-bench uses different arg names sometimes?)
             # llama-bench: -mmp (mmap)
             extra_args = [
                 "-mmp", "0",
                 "-fa", "1"
             ]
             # bench usually controls context via other flags, user didn't ask for it here.
        else:
             extra_args = []

        local_cmd = base_args + extra_args
        
        print(f"CMD: {' '.join(local_cmd)}")
        
        proc = subprocess.Popen(local_cmd)
        proc.wait()
        
    except Exception as e:
        print(f"\n[EXCEPTION] {e}")
    finally:
        cleanup()
    
    input("\nRun complete. Press Enter to return to menu...")


def main_menu():
    state = AppState()
    
    while True:
        model_display = Path(state.model_path).name if state.model_path else "(None)"
        servers_display = f"{len(state.active_hosts)} Active"
        context_display = str(state.context_size) if state.context_size else "Default"
        
        menu = [
            "--clear", "--backtitle", "AMD Strix Halo - Distributed Llama",
            "--title", "Main Menu",
            "--menu", "Select an option to configure or run:", "20", "60", "7",
            "1", f"Model:   {model_display}",
            "2", f"Toolbox: {state.toolbox}",
            "3", f"Servers: {servers_display}",
            "4", f"Mode:    {state.mode}",
            "5", f"Context: {context_display}",
            "6", "RUN DISTRIBUTED SERVER",
            "7", "Exit"
        ]
        
        choice, code = run_dialog(menu)
        
        if code != 0: # Cancel/Esc
            break
            
        if choice == "1":
            select_model(state)
        elif choice == "2":
            select_toolbox(state)
        elif choice == "3":
            configure_servers(state)
        elif choice == "4":
            select_mode(state)
        elif choice == "5":
            select_context(state)
        elif choice == "6":
            run_distributed(state)
        elif choice == "7":
            break

    subprocess.run(["clear"])
    exit(0)

if __name__ == "__main__":
    check_dependencies()
    try:
        main_menu()
    except KeyboardInterrupt:
        subprocess.run(["clear"])
        sys.exit(0)
