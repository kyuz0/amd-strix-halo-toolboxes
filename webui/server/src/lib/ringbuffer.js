/**
 * Fixed-capacity ring that hands out a monotonically increasing sequence number
 * per entry, so an SSE client that reconnects with `Last-Event-ID` can be sent
 * exactly what it missed.
 */
export class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity
    /** @type {{seq: number, value: any}[]} */
    this.items = []
    this.nextSeq = 1
  }

  push(value) {
    const entry = { seq: this.nextSeq++, value }
    this.items.push(entry)
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity)
    }
    return entry
  }

  /** Everything currently held, oldest first. */
  all() {
    return this.items
  }

  /** Entries newer than `seq`. Returns everything if `seq` is not a number. */
  since(seq) {
    if (!Number.isFinite(seq)) return this.items
    return this.items.filter((e) => e.seq > seq)
  }

  get length() {
    return this.items.length
  }

  clear() {
    this.items = []
  }
}
