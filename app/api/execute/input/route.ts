import { NextRequest, NextResponse } from "next/server";

// Import the input queues from the parent route
// Note: This works because both files are part of the same runtime
const inputQueues = new Map<string, {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}>();

// Use a global to share state between routes
if (typeof global !== "undefined") {
  (global as any).inputQueues = (global as any).inputQueues || inputQueues;
}

export async function POST(request: NextRequest) {
  const { sessionId, input } = await request.json();

  console.log(`[HTTP] POST /api/execute/input - Session: ${sessionId}, Input length: ${input?.length || 0} characters`);

  if (!sessionId || typeof sessionId !== "string") {
    return NextResponse.json(
      { error: "Session ID is required" },
      { status: 400 }
    );
  }

  const queues = (global as any).inputQueues as Map<string, {
    resolve: (value: string) => void;
    reject: (error: Error) => void;
  }>;

  const inputQueue = queues.get(sessionId);

  if (!inputQueue) {
    return NextResponse.json(
      { error: "No input request found for this session" },
      { status: 404 }
    );
  }

  // Resolve the promise with the user's input
  inputQueue.resolve(input);
  queues.delete(sessionId);

  return NextResponse.json({ success: true });
}

