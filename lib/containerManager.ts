import { spawn, ChildProcess } from "child_process";

export interface ContainerSession {
  sessionId: string;
  containerId: string;
  process: ChildProcess;
  createdAt: Date;
}

class ContainerManager {
  private containers: Map<string, ContainerSession> = new Map();
  private readonly IMAGE_NAME = "python-sandbox";
  private readonly CONTAINER_PREFIX = "python-session-";
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start periodic cleanup of stale containers (every 5 minutes)
    this.startPeriodicCleanup();
  }

  /**
   * Build the Docker image for Python sandbox
   */
  async buildImage(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log("[CONTAINER] Building Docker image...");
      const build = spawn("docker", [
        "build",
        "-t",
        this.IMAGE_NAME,
        ".",
      ], {
        cwd: process.cwd(),
      });

      let output = "";
      let errorOutput = "";

      build.stdout.on("data", (data) => {
        output += data.toString();
      });

      build.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });

      build.on("close", (code) => {
        if (code === 0) {
          console.log("[CONTAINER] Docker image built successfully");
          resolve();
        } else {
          console.error("[CONTAINER] Failed to build Docker image:", errorOutput);
          reject(new Error(`Failed to build Docker image: ${errorOutput}`));
        }
      });

      build.on("error", (error) => {
        console.error("[CONTAINER] Error building Docker image:", error);
        reject(error);
      });
    });
  }

  /**
   * Check if Docker image exists, build if not
   */
  async ensureImageExists(): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = spawn("docker", ["images", "-q", this.IMAGE_NAME]);
      
      let output = "";
      check.stdout.on("data", (data) => {
        output += data.toString();
      });

      check.on("close", async (code) => {
        if (code === 0 && output.trim()) {
          console.log("[CONTAINER] Docker image already exists");
          resolve();
        } else {
          console.log("[CONTAINER] Docker image not found, building...");
          try {
            await this.buildImage();
            resolve();
          } catch (error) {
            reject(error);
          }
        }
      });

      check.on("error", (error) => {
        reject(error);
      });
    });
  }

  /**
   * Create and start a new container for a session
   */
  async createContainer(sessionId: string): Promise<ContainerSession> {
    await this.ensureImageExists();

    const containerName = `${this.CONTAINER_PREFIX}${sessionId}`;
    
    return new Promise((resolve, reject) => {
      console.log(`[CONTAINER] Creating container: ${containerName}`);
      
      // Run Docker container with resource limits
      const dockerProcess = spawn("docker", [
        "run",
        "--rm",  // Automatically remove container when it exits
        "--name", containerName,
        "--network", "none",  // No network access for security
        "--memory", "256m",  // Memory limit
        "--cpus", "0.5",  // CPU limit
        "--pids-limit", "50",  // Process limit
        "-i",  // Interactive (keep stdin open)
        this.IMAGE_NAME,
        sessionId,
      ]);

      const session: ContainerSession = {
        sessionId,
        containerId: containerName,
        process: dockerProcess,
        createdAt: new Date(),
      };

      this.containers.set(sessionId, session);
      console.log(`[CONTAINER] Container created: ${containerName}`);
      
      // Set up cleanup on container exit
      dockerProcess.on("close", () => {
        this.containers.delete(sessionId);
        console.log(`[CONTAINER] Container ${containerName} cleaned up`);
      });

      resolve(session);
    });
  }

  /**
   * Get a container session by session ID
   */
  getContainer(sessionId: string): ContainerSession | undefined {
    return this.containers.get(sessionId);
  }

  /**
   * Stop and remove a container
   */
  async stopContainer(sessionId: string): Promise<void> {
    const session = this.containers.get(sessionId);
    
    if (!session) {
      console.log(`[CONTAINER] No container found for session: ${sessionId}`);
      return;
    }

    console.log(`[CONTAINER] Stopping container: ${session.containerId}`);

    return new Promise((resolve) => {
      // Kill the docker process (this will automatically remove the container due to --rm flag)
      session.process.kill("SIGTERM");
      
      // Give it a moment, then force kill if needed
      setTimeout(() => {
        if (!session.process.killed) {
          session.process.kill("SIGKILL");
        }
        
        // Also try to stop via docker command as backup
        const stop = spawn("docker", ["stop", session.containerId]);
        stop.on("close", () => {
          this.containers.delete(sessionId);
          console.log(`[CONTAINER] Container stopped: ${session.containerId}`);
          resolve();
        });
        
        // Don't wait forever
        setTimeout(resolve, 2000);
      }, 1000);
    });
  }

  /**
   * Clean up all stale containers (older than 10 minutes)
   */
  async cleanupStaleContainers(): Promise<void> {
    const now = new Date();
    const staleThreshold = 10 * 60 * 1000; // 10 minutes

    for (const [sessionId, session] of this.containers.entries()) {
      const age = now.getTime() - session.createdAt.getTime();
      if (age > staleThreshold) {
        console.log(`[CONTAINER] Cleaning up stale container: ${session.containerId}`);
        await this.stopContainer(sessionId);
      }
    }
  }

  /**
   * Start periodic cleanup
   */
  private startPeriodicCleanup(): void {
    if (this.cleanupInterval) {
      return;
    }

    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleContainers().catch(error => {
        console.error("[CONTAINER] Error during periodic cleanup:", error);
      });
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  /**
   * Stop periodic cleanup (useful for testing or shutdown)
   */
  stopPeriodicCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): string[] {
    return Array.from(this.containers.keys());
  }

  /**
   * Clean up all containers (useful for graceful shutdown)
   */
  async cleanupAll(): Promise<void> {
    console.log("[CONTAINER] Cleaning up all containers...");
    const sessions = Array.from(this.containers.keys());
    await Promise.all(sessions.map(sessionId => this.stopContainer(sessionId)));
    this.stopPeriodicCleanup();
  }
}

// Export a singleton instance
export const containerManager = new ContainerManager();

// Cleanup on process exit
if (typeof process !== "undefined") {
  process.on("SIGINT", async () => {
    await containerManager.cleanupAll();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await containerManager.cleanupAll();
    process.exit(0);
  });
}

