import { NextRequest, NextResponse } from "next/server";
import { containerManager } from "../../../../lib/containerManager";

export async function POST(request: NextRequest) {
  const { sessionId } = await request.json();
  
  console.log(`[HTTP] POST /api/execute/stop - Session: ${sessionId}`);
  console.log("[SERVER DEBUG] Stop request received for session:", sessionId);

  if (!sessionId || typeof sessionId !== "string") {
    console.log("[SERVER DEBUG] Invalid session ID");
    return NextResponse.json(
      { error: "Session ID is required" },
      { status: 400 }
    );
  }

  const containerSessions = (global as any).containerSessions as Map<string, any>;

  if (!containerSessions) {
    console.log("[SERVER DEBUG] No container storage found");
    return NextResponse.json(
      { error: "No container storage found" },
      { status: 404 }
    );
  }

  const containerSession = containerSessions.get(sessionId);

  if (!containerSession) {
    console.log("[SERVER DEBUG] No container found for session:", sessionId);
    console.log("[SERVER DEBUG] Available sessions:", Array.from(containerSessions.keys()));
    return NextResponse.json(
      { error: "No container found for this session" },
      { status: 404 }
    );
  }

  try {
    console.log("[SERVER DEBUG] Stopping container for session:", sessionId);
    
    // Stop the container using the container manager
    await containerManager.stopContainer(sessionId);
    
    console.log("[SERVER DEBUG] Container stopped, cleaning up");
    
    // Clean up
    containerSessions.delete(sessionId);
    
    // Also clean up any pending input queues
    const inputQueues = (global as any).inputQueues as Map<string, any>;
    if (inputQueues) {
      inputQueues.delete(sessionId);
      console.log("[SERVER DEBUG] Input queue cleaned up");
    }

    console.log("[SERVER DEBUG] Stop completed successfully");
    return NextResponse.json({ success: true, message: "Container stopped" });
  } catch (error: any) {
    console.error("[SERVER DEBUG] Error stopping container:", error);
    return NextResponse.json(
      { error: `Failed to stop container: ${error.message}` },
      { status: 500 }
    );
  }
}

