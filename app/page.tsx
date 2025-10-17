"use client";

import { useState, useRef, useEffect } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { python } from "@codemirror/lang-python";
import React from "react";

interface ConsoleMessage {
  type: "output" | "input" | "error" | "system";
  content: string;
}

export default function Home() {
  const [code, setCode] = useState(`# Write your Python code here
print("Hello, World!")
name = input("Enter your name: ")
print(f"Hello, {name}!")

for i in range(3):
    print(f"Count: {i}")
`);
  const [consoleMessages, setConsoleMessages] = useState<ConsoleMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [waitingForInput, setWaitingForInput] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const inputResolverRef = useRef<((value: string) => void) | null>(null);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const shouldContinueProcessing = useRef<boolean>(true);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [consoleMessages]);

  const addConsoleMessage = (type: ConsoleMessage["type"], content: string) => {
    setConsoleMessages((prev) => [...prev, { type, content }]);
  };

  const handleInputSubmit = () => {
    if (!waitingForInput || !inputResolverRef.current) return;
    
    inputResolverRef.current(inputValue);
    setInputValue("");
    setWaitingForInput(false);
    inputResolverRef.current = null;
  };

  const waitForInput = (): Promise<string> => {
    return new Promise((resolve) => {
      setWaitingForInput(true);
      inputResolverRef.current = resolve;
    });
  };

  const stopExecution = async () => {
    // Immediately set flag to stop processing stream
    shouldContinueProcessing.current = false;
    
    // First, reject any pending input promises to unblock the execution loop
    if (inputResolverRef.current) {
      inputResolverRef.current("__EXECUTION_STOPPED__");
      inputResolverRef.current = null;
    }
    
    // Abort the fetch request immediately
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // Update state immediately
    setIsRunning(false);
    setWaitingForInput(false);
    setCurrentSessionId(null);
    
    // Then send stop command to server (don't await to keep it non-blocking)
    if (currentSessionId) {
      fetch("/api/execute/stop", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId: currentSessionId }),
      }).then(() => {
        addConsoleMessage("system", "Execution stopped.");
      }).catch((error) => {
        console.error("Error stopping execution:", error);
      });
    }
  };

  const runCode = async () => {
    setIsRunning(true);
    setConsoleMessages([]);
    addConsoleMessage("system", "Running code...");

    // Reset the processing flag
    shouldContinueProcessing.current = true;

    // Create a new abort controller for this execution
    abortControllerRef.current = new AbortController();

    try {
      const response = await fetch("/api/execute", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No reader available");
      }

      while (shouldContinueProcessing.current) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          // Check if we should stop processing
          if (!shouldContinueProcessing.current) {
            break;
          }
          try {
            const message = JSON.parse(line);
            
            if (message.type === "session_start") {
              // Store the session ID for potential stop operation
              setCurrentSessionId(message.sessionId);
            } else if (message.type === "output") {
              addConsoleMessage("output", message.content);
            } else if (message.type === "error") {
              addConsoleMessage("error", message.content);
            } else if (message.type === "input_request") {
              // Add prompt as an input type message (will show inline input)
              addConsoleMessage("input", message.content);
              const userInput = await waitForInput();
              
              // Check if execution was stopped
              if (userInput === "__EXECUTION_STOPPED__") {
                break;
              }
              
              // Update the last message to include the user's input
              setConsoleMessages((prev) => {
                const updated = [...prev];
                if (updated.length > 0) {
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    content: message.content + userInput,
                  };
                }
                return updated;
              });
              
              // Send input back to server
              await fetch("/api/execute/input", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ 
                  sessionId: message.sessionId, 
                  input: userInput 
                }),
              });
            } else if (message.type === "complete") {
              addConsoleMessage("system", "Execution complete.");
            }
          } catch (e) {
            console.error("Failed to parse message:", line, e);
          }
        }
        
        // Also check after processing all lines in the chunk
        if (!shouldContinueProcessing.current) {
          break;
        }
      }
    } catch (error: any) {
      if (error.name === "AbortError") {
        // Fetch was aborted, no need to show error
      } else {
        addConsoleMessage("error", `Error: ${error}`);
      }
    } finally {
      setIsRunning(false);
      setWaitingForInput(false);
      setCurrentSessionId(null);
      inputResolverRef.current = null;
      abortControllerRef.current = null;
      shouldContinueProcessing.current = true;
    }
  };

  const clearConsole = () => {
    setConsoleMessages([]);
  };

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      <header className="bg-gray-800 border-b border-gray-700 p-4">
        <h1 className="text-2xl font-bold text-white">Remote Python Server</h1>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Editor Panel */}
        <div className="w-1/2 flex flex-col border-r border-gray-700">
          <div className="bg-gray-800 px-4 py-2 border-b border-gray-700 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">Code Editor</h2>
            {isRunning ? (
              <button
                onClick={stopExecution}
                className="px-4 py-2 rounded font-medium bg-red-600 hover:bg-red-700 text-white"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={runCode}
                className="px-4 py-2 rounded font-medium bg-green-600 hover:bg-green-700 text-white"
              >
                Run Code
              </button>
            )}
          </div>
          <div className="flex-1 overflow-auto">
            {mounted ? (
              <CodeMirror
                value={code}
                height="100%"
                extensions={[python()]}
                onChange={(value) => setCode(value)}
                theme="dark"
                className="text-base"
              />
            ) : (
              <div className="h-full bg-gray-950 flex items-center justify-center text-gray-500">
                Loading editor...
              </div>
            )}
          </div>
        </div>

        {/* Console Panel */}
        <div className="w-1/2 flex flex-col">
          <div className="bg-gray-800 px-4 py-2 border-b border-gray-700 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-white">Console</h2>
            <button
              onClick={clearConsole}
              className="px-3 py-1 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm"
            >
              Clear
            </button>
          </div>
          
          <div className="flex-1 overflow-auto bg-black p-4 font-mono text-sm">
            {consoleMessages.map((msg, index) => {
              const isLastMessage = index === consoleMessages.length - 1;
              const isWaitingOnThisLine = waitingForInput && isLastMessage && msg.type === "input";
              
              return (
                <div
                  key={index}
                  className={`mb-1 ${
                    msg.type === "output"
                      ? "text-gray-100"
                      : msg.type === "input"
                      ? "text-blue-400"
                      : msg.type === "error"
                      ? "text-red-400"
                      : "text-green-400"
                  }`}
                >
                  {msg.content}
                  {isWaitingOnThisLine && (
                    <input
                      type="text"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleInputSubmit()}
                      autoFocus
                      className="bg-transparent text-yellow-300 outline-none border-none ml-0 inline-block"
                      style={{ width: `${Math.max(inputValue.length + 1, 10)}ch` }}
                    />
                  )}
                </div>
              );
            })}
            <div ref={consoleEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}
