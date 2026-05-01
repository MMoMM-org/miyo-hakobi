// In-flight execution tracking for scheduled rules.
//
// WHY this module exists:
// The Scheduler implements overlap-skip semantics per PRD/F3: if a rule's
// previous execution is still in-flight when the next tick arrives, that tick
// is skipped. This registry tracks which rules are actively executing without
// needing external synchronization. JS's single-threaded event loop guarantees
// that tryAcquire/release are atomic operations — a Mutex or promise-based lock
// is unnecessary (see SDD/ADR-9 for the design rationale).

import type { RuleId } from "../domain/ruleId";

export class InFlightRegistry {
	private inFlight: Map<RuleId, true>;

	constructor() {
		this.inFlight = new Map();
	}

	tryAcquire(ruleId: RuleId): boolean {
		if (this.inFlight.has(ruleId)) {
			return false;
		}
		this.inFlight.set(ruleId, true);
		return true;
	}

	release(ruleId: RuleId): void {
		this.inFlight.delete(ruleId);
	}

	size(): number {
		return this.inFlight.size;
	}

	isInFlight(ruleId: RuleId): boolean {
		return this.inFlight.has(ruleId);
	}
}
