import { afterEach, describe, expect, it, vi } from "vitest";
import { log, setDebugSource } from "../../src/util/logger";

describe("log", () => {
	afterEach(() => {
		setDebugSource(null);
		vi.restoreAllMocks();
	});

	describe("debug", () => {
		it("writes nothing when no source is registered", () => {
			const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
			log.debug("hidden");
			expect(spy).not.toHaveBeenCalled();
		});

		it("writes nothing when the source returns false", () => {
			const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
			setDebugSource(() => false);
			log.debug("hidden");
			expect(spy).not.toHaveBeenCalled();
		});

		it("writes to console.debug when the source returns true", () => {
			const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
			setDebugSource(() => true);
			log.debug("shown", 1);
			expect(spy).toHaveBeenCalledWith("shown", 1);
		});

		it("follows the source live, so flipping the backing variable changes the next call", () => {
			const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
			let enabled = false;
			setDebugSource(() => enabled);

			log.debug("first");
			enabled = true;
			log.debug("second");
			enabled = false;
			log.debug("third");

			expect(spy).toHaveBeenCalledTimes(1);
			expect(spy).toHaveBeenCalledWith("second");
		});

		it("restores the off state when setDebugSource(null) is called", () => {
			const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
			setDebugSource(() => true);
			setDebugSource(null);
			log.debug("hidden");
			expect(spy).not.toHaveBeenCalled();
		});
	});

	describe("lifecycle", () => {
		it("always writes console.debug, regardless of the debug source", () => {
			const spy = vi.spyOn(console, "debug").mockImplementation(() => {});

			log.lifecycle("no source");
			setDebugSource(() => false);
			log.lifecycle("source off");
			setDebugSource(() => true);
			log.lifecycle("source on");

			expect(spy).toHaveBeenCalledTimes(3);
			expect(spy).toHaveBeenNthCalledWith(1, "no source");
			expect(spy).toHaveBeenNthCalledWith(2, "source off");
			expect(spy).toHaveBeenNthCalledWith(3, "source on");
		});
	});

	describe("warn and error", () => {
		it("always write console.warn and console.error respectively", () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const error = vi.spyOn(console, "error").mockImplementation(() => {});

			log.warn("w");
			log.error("e");

			expect(warn).toHaveBeenCalledWith("w");
			expect(error).toHaveBeenCalledWith("e");
		});

		it("do not depend on the debug source", () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			setDebugSource(() => false);
			log.warn("w");
			expect(warn).toHaveBeenCalledWith("w");
		});
	});
});
