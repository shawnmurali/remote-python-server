#!/usr/bin/env python3
"""
Python code executor with custom print and input functions.
This script receives code via stdin and executes it with overloaded I/O functions.
"""

import sys
import json
import traceback
import io
from contextlib import redirect_stdout, redirect_stderr


class InteractiveIO:
    """Handles interactive I/O with the frontend."""
    
    def __init__(self, session_id):
        self.session_id = session_id
        self.original_stdout = sys.stdout
        self.original_stderr = sys.stderr
        self.original_stdin = sys.stdin
    
    def print_output(self, text):
        """Send output to the frontend."""
        message = {
            "type": "output",
            "content": str(text)
        }
        print(json.dumps(message), file=self.original_stdout, flush=True)
    
    def print_error(self, text):
        """Send error to the frontend."""
        message = {
            "type": "error",
            "content": str(text)
        }
        print(json.dumps(message), file=self.original_stdout, flush=True)
    
    def request_input(self, prompt=""):
        """Request input from the frontend."""
        message = {
            "type": "input_request",
            "prompt": prompt,
            "sessionId": self.session_id
        }
        print(json.dumps(message), file=self.original_stdout, flush=True)
        
        # Read input from the Node.js process
        user_input = self.original_stdin.readline().strip()
        return user_input


def create_custom_globals(io_handler):
    """Create custom global namespace with overloaded print and input."""
    
    def custom_print(*args, sep=' ', end='\n', file=None, flush=False):
        """Custom print function that sends output to the frontend."""
        output = sep.join(str(arg) for arg in args) + end
        io_handler.print_output(output.rstrip('\n'))
    
    def custom_input(prompt=""):
        """Custom input function that requests input from the frontend."""
        return io_handler.request_input(prompt)
    
    # Create a namespace with the custom functions
    custom_globals = {
        '__builtins__': __builtins__,
        'print': custom_print,
        'input': custom_input,
    }
    
    return custom_globals


def execute_code(code, session_id):
    """Execute Python code with custom I/O handlers."""
    io_handler = InteractiveIO(session_id)
    
    try:
        # Create custom globals with overloaded functions
        custom_globals = create_custom_globals(io_handler)
        
        # Capture stdout and stderr
        stdout_capture = io.StringIO()
        stderr_capture = io.StringIO()
        
        # Execute the code
        with redirect_stdout(stdout_capture), redirect_stderr(stderr_capture):
            exec(code, custom_globals)
        
        # Send any captured stdout/stderr
        stdout_content = stdout_capture.getvalue()
        if stdout_content:
            io_handler.print_output(stdout_content.rstrip('\n'))
        
        stderr_content = stderr_capture.getvalue()
        if stderr_content:
            io_handler.print_error(stderr_content.rstrip('\n'))
            
    except Exception as e:
        # Send the error traceback
        error_traceback = traceback.format_exc()
        io_handler.print_error(error_traceback)


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: python-runner.py <session_id>", file=sys.stderr)
        sys.exit(1)
    
    session_id = sys.argv[1]
    
    # Read code from stdin until delimiter
    code_lines = []
    for line in sys.stdin:
        if line.strip() == "__END_OF_CODE__":
            break
        code_lines.append(line)
    
    code = ''.join(code_lines)
    
    if not code:
        error_msg = {
            "type": "error",
            "content": "No code provided"
        }
        print(json.dumps(error_msg), flush=True)
        sys.exit(1)
    
    # Execute the code
    execute_code(code, session_id)


if __name__ == "__main__":
    main()

