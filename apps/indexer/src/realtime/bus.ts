import { EventEmitter } from "node:events";
import type { RealtimeMessage } from "@atlaspad/shared";

/** In-process pub/sub between the indexer loops and SSE clients. */
export class RealtimeBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(10_000);
  }

  publish(message: RealtimeMessage): void {
    this.emitter.emit("message", message);
  }

  subscribe(listener: (message: RealtimeMessage) => void): () => void {
    this.emitter.on("message", listener);
    return () => this.emitter.off("message", listener);
  }

  get subscribers(): number {
    return this.emitter.listenerCount("message");
  }
}
