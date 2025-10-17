# Remote Python Server

A Next.js fullstack application that provides an interactive Python code execution environment with a CodeMirror editor and console.

## Features

- **CodeMirror Editor**: Syntax-highlighted Python code editor
- **Interactive Console**: Real-time output display with input handling
- **Custom I/O**: Overloaded `print()` and `input()` functions that communicate with the frontend
- **Streaming Execution**: Code executes on the server with streaming output to the client

## Prerequisites

- Node.js (v18 or higher)
- pnpm
- Python 3

## Installation

```bash
# Install dependencies
pnpm install
```

## Running the Application

```bash
# Development mode
pnpm dev

# Build for production
pnpm build

# Run production server
pnpm start
```

The application will be available at `http://localhost:3000`.

## How It Works

1. **Frontend**: Built with Next.js and React, uses CodeMirror for code editing
2. **API Route**: `/api/execute` spawns a Python process to execute code
3. **Python Runner**: Custom Python script that:
   - Overloads `print()` to send output to the frontend
   - Overloads `input()` to request input from the frontend
   - Communicates via JSON messages over stdout
4. **Streaming**: Uses Server-Sent Events for real-time output streaming
5. **Interactive Input**: When Python code calls `input()`, the frontend displays an input field

## Architecture

```
Frontend (React/CodeMirror)
    ↕ (HTTP POST with streaming)
API Route (/api/execute)
    ↕ (stdin/stdout)
Python Runner (python-runner.py)
    → Executes user code with custom I/O
```

## Example Code

```python
# Simple example
print("Hello, World!")
name = input("Enter your name: ")
print(f"Hello, {name}!")

# Loop example
for i in range(3):
    print(f"Count: {i}")
```

## Technical Details

- **Session Management**: Each execution gets a unique session ID for managing I/O
- **Input Handling**: Input requests create a promise that waits for user input via a separate API endpoint
- **Error Handling**: Python exceptions are caught and displayed in the console
- **Process Management**: Python processes are properly cleaned up after execution

## License

MIT
