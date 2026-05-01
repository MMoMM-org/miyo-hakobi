import { describe, expect, it } from "vitest";
import { InFlightRegistry } from "../../src/scheduler/InFlightRegistry";
import { newRuleId } from "../../src/domain/ruleId";

describe("InFlightRegistry", () => {
	it("tryAcquire returns true on first call", () => {
		const reg = new InFlightRegistry();
		const id = newRuleId();

		const result = reg.tryAcquire(id);

		expect(result).toBe(true);
	});

	it("tryAcquire returns false on second call for same id", () => {
		const reg = new InFlightRegistry();
		const id = newRuleId();

		reg.tryAcquire(id);
		const secondResult = reg.tryAcquire(id);

		expect(secondResult).toBe(false);
	});

	it("release allows re-acquire", () => {
		const reg = new InFlightRegistry();
		const id = newRuleId();

		reg.tryAcquire(id);
		reg.release(id);
		const reacquired = reg.tryAcquire(id);

		expect(reacquired).toBe(true);
	});

	it("two distinct ids are independent", () => {
		const reg = new InFlightRegistry();
		const id1 = newRuleId();
		const id2 = newRuleId();

		const acquire1 = reg.tryAcquire(id1);
		const acquire2 = reg.tryAcquire(id2);

		expect(acquire1).toBe(true);
		expect(acquire2).toBe(true);
	});

	it("concurrent simulation: exactly one of 100 tryAcquire calls succeeds for same id", async () => {
		const reg = new InFlightRegistry();
		const id = newRuleId();

		const results = await Promise.all(
			Array.from({ length: 100 }, () =>
				Promise.resolve().then(() => reg.tryAcquire(id))
			)
		);

		const trueCount = results.filter((r) => r).length;
		expect(trueCount).toBe(1);
	});

	it("size reflects active in-flight count", () => {
		const reg = new InFlightRegistry();
		const id1 = newRuleId();
		const id2 = newRuleId();
		const id3 = newRuleId();

		expect(reg.size()).toBe(0);

		reg.tryAcquire(id1);
		expect(reg.size()).toBe(1);

		reg.tryAcquire(id2);
		expect(reg.size()).toBe(2);

		reg.tryAcquire(id3);
		expect(reg.size()).toBe(3);

		reg.release(id1);
		expect(reg.size()).toBe(2);

		reg.release(id2);
		expect(reg.size()).toBe(1);

		reg.release(id3);
		expect(reg.size()).toBe(0);
	});

	it("release of non-acquired id is a no-op", () => {
		const reg = new InFlightRegistry();
		const id = newRuleId();

		expect(() => {
			reg.release(id);
		}).not.toThrow();

		expect(reg.size()).toBe(0);
	});

	it("isInFlight returns true for acquired id, false otherwise", () => {
		const reg = new InFlightRegistry();
		const id1 = newRuleId();
		const id2 = newRuleId();

		reg.tryAcquire(id1);

		expect(reg.isInFlight(id1)).toBe(true);
		expect(reg.isInFlight(id2)).toBe(false);

		reg.release(id1);
		expect(reg.isInFlight(id1)).toBe(false);
	});
});
