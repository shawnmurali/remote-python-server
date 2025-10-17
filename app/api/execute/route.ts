import { NextRequest, NextResponse } from "next/server";
import { ChildProcess } from "child_process";
import { randomUUID } from "crypto";
import { containerManager } from "../../../lib/containerManager";

// Global session storage for sharing between routes
if (typeof global !== "undefined") {
  (global as any).inputQueues = (global as any).inputQueues || new Map();
  (global as any).containerSessions = (global as any).containerSessions || new Map();
}

export async function POST(request: NextRequest) {
  const { code } = await request.json();
  
  console.log(`[HTTP] POST /api/execute - Code length: ${code?.length || 0} characters`);
  console.log("[SERVER DEBUG] Execute request received");

  if (!code || typeof code !== "string") {
    console.log("[SERVER DEBUG] Invalid code provided");
    return NextResponse.json(
      { error: "Code is required and must be a string" },
      { status: 400 }
    );
  }

  const sessionId = randomUUID();
  console.log("[SERVER DEBUG] Created session:", sessionId);

  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  let streamClosed = false;
  
  const sendMessage = async (message: any) => {
    if (streamClosed) {
      return; // Don't try to write if stream is closed
    }
    try {
      await writer.write(encoder.encode(JSON.stringify(message) + "\n"));
    } catch (e) {
      // Stream was likely closed/aborted by client
      streamClosed = true;
      console.log("[SERVER DEBUG] Stream closed, cannot send message");
    }
  };

  const inputQueues = (global as any).inputQueues as Map<string, {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  }>;

  const containerSessions = (global as any).containerSessions as Map<string, any>;

  // Start Python execution asynchronously
  (async () => {
    try {
      console.log("[SERVER DEBUG] Sending session_start message");
      
      // Send session ID to the client immediately
      await sendMessage({
        type: "session_start",
        sessionId: sessionId,
      });

      console.log("[SERVER DEBUG] Creating container for session:", sessionId);
      const containerSession = await containerManager.createContainer(sessionId);
      const pythonProcess = containerSession.process;

      // Store the container session for the input route to access
      containerSessions.set(sessionId, containerSession);
      console.log("[SERVER DEBUG] Container created, active sessions:", Array.from(containerSessions.keys()));

      // Send the code to the Python process with a delimiter
      if (pythonProcess.stdin) {
        pythonProcess.stdin.write(code);
        pythonProcess.stdin.write("\n__END_OF_CODE__\n");
        // Don't close stdin - we need it for input later
      }

      pythonProcess.stdout?.on("data", async (data) => {
        const output = data.toString();
        const lines = output.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          try {
            const message = JSON.parse(line);
            
            if (message.type === "input_request") {
              console.log("[SERVER DEBUG] Input request from Python:", message.prompt);
              
              // Store the request and wait for input from the client
              await sendMessage({
                type: "input_request",
                content: message.prompt,
                sessionId: message.sessionId,
              });

              // Wait for input from the client
              try {
                console.log("[SERVER DEBUG] Waiting for input from client");
                const userInput = await waitForInput(sessionId);
                console.log("[SERVER DEBUG] Received input from client:", userInput);
                
                // Send the input back to the Python process
                if (pythonProcess.stdin && pythonProcess.stdin.writable) {
                  pythonProcess.stdin.write(userInput + "\n");
                  console.log("[SERVER DEBUG] Sent input to Python process");
                }
              } catch (error) {
                console.log("[SERVER DEBUG] Input error:", error);
                await sendMessage({ 
                  type: "error", 
                  content: "Input timeout or error" 
                });
                pythonProcess.kill();
              }
            } else {
              await sendMessage(message);
            }
          } catch (e) {
            // Not JSON, treat as regular output
            await sendMessage({ type: "output", content: line });
          }
        }
      });

      pythonProcess.stderr?.on("data", async (data) => {
        await sendMessage({ type: "error", content: data.toString() });
      });

      pythonProcess.on("close", async (code) => {
        console.log("[SERVER DEBUG] Python process closed with code:", code);
        
        if (code !== 0 && code !== null) {
          await sendMessage({
            type: "error",
            content: `Process exited with code ${code}`,
          });
        }
        await sendMessage({ type: "complete" });
        
        // Close writer if not already closed
        if (!streamClosed) {
          try {
            await writer.close();
            streamClosed = true;
          } catch (e) {
            console.log("[SERVER DEBUG] Writer already closed");
          }
        }
        
        // Clean up
        inputQueues.delete(sessionId);
        containerSessions.delete(sessionId);
        console.log("[SERVER DEBUG] Cleanup complete for session:", sessionId);
      });

      pythonProcess.on("error", async (error) => {
        console.log("[SERVER DEBUG] Python process error:", error);
        await sendMessage({ type: "error", content: error.message });
        
        if (!streamClosed) {
          try {
            await writer.close();
            streamClosed = true;
          } catch (e) {
            console.log("[SERVER DEBUG] Writer already closed");
          }
        }
        
        inputQueues.delete(sessionId);
        containerSessions.delete(sessionId);
      });
    } catch (error: any) {
      console.log("[SERVER DEBUG] Error in execution:", error);
      await sendMessage({ type: "error", content: error.message });
      
      if (!streamClosed) {
        try {
          await writer.close();
          streamClosed = true;
        } catch (e) {
          console.log("[SERVER DEBUG] Writer already closed");
        }
      }
      
      inputQueues.delete(sessionId);
      containerSessions.delete(sessionId);
    }
  })();

  return new NextResponse(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx buffering
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function waitForInput(sessionId: string): Promise<string> {
  const inputQueues = (global as any).inputQueues as Map<string, {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  }>;

  return new Promise((resolve, reject) => {
    inputQueues.set(sessionId, { resolve, reject });
    
    // Set a timeout to avoid hanging forever
    setTimeout(() => {
      if (inputQueues.has(sessionId)) {
        inputQueues.delete(sessionId);
        reject(new Error("Input timeout"));
      }
    }, 120000); // 120 second timeout
  });
}

