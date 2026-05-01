// Tests for src/fs/NodeFs.ts — thin time-bounded wrapper around `node:fs/promises`
// (T1.7). Each method must (a) delegate to the underlying fs/promises call, (b)
// race the operation against a per-call timeout (read fresh from the DI factory),
// and (c) map all underlying error codes into the closed IoError hierarchy whose
// `errorCode` values are a strict subset of ERROR_CODE_VALUES from
// src/audit/AuditEntry.ts. No raw Error subclasses leak from any public method.
//
// Mocking strategy: `vi.mock("node:fs/promises", ...)` replaces the eight calls
// the adapter consumes with vitest-controlled spies. Because the adapter is the
// only thing that touches fs/promises in v0.1, this mock is total at the module
// boundary — no real filesystem traffic occurs in this suite.

import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.mock is hoisted to the top of the file. Anything its factory closes over
// must be hoisted with it, so we build the mock object via vi.hoisted() — which
// guarantees the same object is reachable from both the factory and the test
// bodies.
const mocks = vi.hoisted(() => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  lstat: vi.fn(),
  rename: vi.fn(),
  unlink: vi.fn(),
  readdir: vi.fn(),
  realpath: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock("node:fs/promises", () => mocks);

// Import AFTER vi.mock so the adapter sees our mocked module.
import {
  NodeFs,
  IoError,
  IoTimeoutError,
  IoNotFoundError,
  IoPermissionError,
  IoUnknownError,
  type IoErrorCode,
} from "../../src/fs/NodeFs";
import { ERROR_CODE_VALUES } from "../../src/audit/AuditEntry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a NodeFs with a static timeout. */
function fixedTimeout(ms: number): NodeFs {
  return new NodeFs({ timeoutMs: () => ms });
}

/** A Promise that never resolves — used to force timeouts. */
function never<T = never>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

/** Build a Node-style ErrnoException with the given `.code`. */
function errnoErr(code: string, message = `${code} simulated`): NodeJS.ErrnoException {
  const err = new Error(message) as NodeJS.ErrnoException;
  err.code = code;
  return err;
}

beforeEach(() => {
  for (const key of Object.keys(mocks) as Array<keyof typeof mocks>) {
    mocks[key].mockReset();
  }
});

// ---------------------------------------------------------------------------
// Constructor + DI
// ---------------------------------------------------------------------------

describe("NodeFs — construction", () => {
  it("exposes the eight required methods", () => {
    const fs = fixedTimeout(100);
    expect(typeof fs.readFile).toBe("function");
    expect(typeof fs.writeFile).toBe("function");
    expect(typeof fs.lstat).toBe("function");
    expect(typeof fs.rename).toBe("function");
    expect(typeof fs.unlink).toBe("function");
    expect(typeof fs.readdir).toBe("function");
    expect(typeof fs.realpath).toBe("function");
    expect(typeof fs.mkdir).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Happy-path delegation (one test per method)
// ---------------------------------------------------------------------------

describe("NodeFs — happy-path delegation", () => {
  it("readFile delegates to fs/promises.readFile and returns its value", async () => {
    mocks.readFile.mockResolvedValueOnce("hello");
    const fs = fixedTimeout(1000);
    await expect(fs.readFile("/p/file.txt")).resolves.toBe("hello");
    expect(mocks.readFile).toHaveBeenCalledWith("/p/file.txt", "utf8");
  });

  it("writeFile delegates with (path, data)", async () => {
    mocks.writeFile.mockResolvedValueOnce(undefined);
    const fs = fixedTimeout(1000);
    await fs.writeFile("/p/out.txt", "contents");
    expect(mocks.writeFile).toHaveBeenCalledWith("/p/out.txt", "contents");
  });

  it("lstat delegates and returns a value with isSymbolicLink/isDirectory/isFile", async () => {
    // Note: the returned shape is structurally compatible with
    // FsScopeAdapter['lstat'] in src/domain/scope.ts — assert the methods exist
    // and that boolean returns are passed through untransformed.
    const fakeStats = {
      isSymbolicLink: () => true,
      isDirectory: () => false,
      isFile: () => false,
    };
    mocks.lstat.mockResolvedValueOnce(fakeStats);
    const fs = fixedTimeout(1000);
    const out = await fs.lstat("/p/link");
    expect(out.isSymbolicLink()).toBe(true);
    expect(out.isDirectory()).toBe(false);
    expect(out.isFile()).toBe(false);
    expect(mocks.lstat).toHaveBeenCalledWith("/p/link");
  });

  it("lstat returns the false branch of isSymbolicLink for ordinary files", async () => {
    const fakeStats = {
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => true,
    };
    mocks.lstat.mockResolvedValueOnce(fakeStats);
    const fs = fixedTimeout(1000);
    const out = await fs.lstat("/p/file");
    expect(out.isSymbolicLink()).toBe(false);
    expect(out.isFile()).toBe(true);
  });

  it("rename delegates with (from, to)", async () => {
    mocks.rename.mockResolvedValueOnce(undefined);
    const fs = fixedTimeout(1000);
    await fs.rename("/p/a", "/p/b");
    expect(mocks.rename).toHaveBeenCalledWith("/p/a", "/p/b");
  });

  it("unlink delegates with (path)", async () => {
    mocks.unlink.mockResolvedValueOnce(undefined);
    const fs = fixedTimeout(1000);
    await fs.unlink("/p/gone.txt");
    expect(mocks.unlink).toHaveBeenCalledWith("/p/gone.txt");
  });

  it("readdir delegates and returns the array", async () => {
    mocks.readdir.mockResolvedValueOnce(["a.txt", "b.txt"]);
    const fs = fixedTimeout(1000);
    await expect(fs.readdir("/p/dir")).resolves.toEqual(["a.txt", "b.txt"]);
    expect(mocks.readdir).toHaveBeenCalledWith("/p/dir");
  });

  it("realpath delegates and returns the resolved string", async () => {
    mocks.realpath.mockResolvedValueOnce("/real/p");
    const fs = fixedTimeout(1000);
    await expect(fs.realpath("/p/link")).resolves.toBe("/real/p");
    expect(mocks.realpath).toHaveBeenCalledWith("/p/link");
  });

  it("mkdir delegates with (path, { recursive: true })", async () => {
    mocks.mkdir.mockResolvedValueOnce(undefined);
    const fs = fixedTimeout(1000);
    await fs.mkdir("/p/new/dir");
    expect(mocks.mkdir).toHaveBeenCalledWith("/p/new/dir", { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// Timeout behaviour (one test per method — they all share runWithTimeout, but
// the contract is per-method).
// ---------------------------------------------------------------------------

describe("NodeFs — timeout behaviour", () => {
  it("readFile times out with IoTimeoutError when fs/promises hangs", async () => {
    mocks.readFile.mockImplementationOnce(() => never<string>());
    const fs = fixedTimeout(20);
    await expect(fs.readFile("/p/slow")).rejects.toBeInstanceOf(IoTimeoutError);
  });

  it("IoTimeoutError carries errorCode='io-timeout' and includes op + path", async () => {
    mocks.readFile.mockImplementationOnce(() => never<string>());
    const fs = fixedTimeout(20);
    try {
      await fs.readFile("/p/slow");
      throw new Error("expected timeout");
    } catch (e) {
      expect(e).toBeInstanceOf(IoTimeoutError);
      const ioErr = e as IoTimeoutError;
      expect(ioErr.errorCode).toBe("io-timeout");
      expect(ioErr.opName).toBe("readFile");
      expect(ioErr.path).toBe("/p/slow");
      expect(ioErr.message).toContain("readFile");
      expect(ioErr.message).toContain("/p/slow");
    }
  });

  it("writeFile times out", async () => {
    mocks.writeFile.mockImplementationOnce(() => never<void>());
    const fs = fixedTimeout(20);
    await expect(fs.writeFile("/p/slow", "x")).rejects.toBeInstanceOf(IoTimeoutError);
  });

  it("lstat times out", async () => {
    mocks.lstat.mockImplementationOnce(() => never());
    const fs = fixedTimeout(20);
    await expect(fs.lstat("/p/slow")).rejects.toBeInstanceOf(IoTimeoutError);
  });

  it("rename times out", async () => {
    mocks.rename.mockImplementationOnce(() => never<void>());
    const fs = fixedTimeout(20);
    await expect(fs.rename("/a", "/b")).rejects.toBeInstanceOf(IoTimeoutError);
  });

  it("unlink times out", async () => {
    mocks.unlink.mockImplementationOnce(() => never<void>());
    const fs = fixedTimeout(20);
    await expect(fs.unlink("/p")).rejects.toBeInstanceOf(IoTimeoutError);
  });

  it("readdir times out", async () => {
    mocks.readdir.mockImplementationOnce(() => never<string[]>());
    const fs = fixedTimeout(20);
    await expect(fs.readdir("/p")).rejects.toBeInstanceOf(IoTimeoutError);
  });

  it("realpath times out", async () => {
    mocks.realpath.mockImplementationOnce(() => never<string>());
    const fs = fixedTimeout(20);
    await expect(fs.realpath("/p")).rejects.toBeInstanceOf(IoTimeoutError);
  });

  it("mkdir times out", async () => {
    mocks.mkdir.mockImplementationOnce(() => never<void>());
    const fs = fixedTimeout(20);
    await expect(fs.mkdir("/p")).rejects.toBeInstanceOf(IoTimeoutError);
  });

  it("cloud-sync placeholder simulation: a 500ms readFile is killed by a 50ms timeout", async () => {
    // Models Dropbox / iCloud / OneDrive on-demand placeholders, where the OS
    // can stall the read for seconds while it materialises the file from cloud.
    mocks.readFile.mockImplementationOnce(
      () => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 500)),
    );
    const fs = fixedTimeout(50);
    await expect(fs.readFile("/cloud/placeholder.txt")).rejects.toBeInstanceOf(IoTimeoutError);
  });
});

// ---------------------------------------------------------------------------
// timeoutMs read-fresh-per-call
// ---------------------------------------------------------------------------

describe("NodeFs — timeoutMs read-fresh-per-call", () => {
  it("re-reads the timeout factory on every operation", async () => {
    let t = 1000;
    const fs = new NodeFs({ timeoutMs: () => t });

    // First call: timeout is 1000 ms — completes immediately, no timeout.
    mocks.readFile.mockResolvedValueOnce("first");
    await expect(fs.readFile("/p/a")).resolves.toBe("first");

    // Mutate the factory's source value — second call must observe the change.
    t = 20;
    mocks.readFile.mockImplementationOnce(() => never<string>());
    await expect(fs.readFile("/p/b")).rejects.toBeInstanceOf(IoTimeoutError);
  });
});

// ---------------------------------------------------------------------------
// Error mapping (canonical case = readFile)
// ---------------------------------------------------------------------------

describe("NodeFs — error mapping", () => {
  it("ENOENT → IoNotFoundError(errorCode='source-not-found')", async () => {
    mocks.readFile.mockRejectedValueOnce(errnoErr("ENOENT"));
    const fs = fixedTimeout(1000);
    try {
      await fs.readFile("/missing");
      throw new Error("expected ENOENT mapping");
    } catch (e) {
      expect(e).toBeInstanceOf(IoNotFoundError);
      expect((e as IoError).errorCode).toBe("source-not-found");
    }
  });

  it("EACCES → IoPermissionError(errorCode='permission-denied')", async () => {
    mocks.readFile.mockRejectedValueOnce(errnoErr("EACCES"));
    const fs = fixedTimeout(1000);
    try {
      await fs.readFile("/private");
      throw new Error("expected EACCES mapping");
    } catch (e) {
      expect(e).toBeInstanceOf(IoPermissionError);
      expect((e as IoError).errorCode).toBe("permission-denied");
    }
  });

  it("EPERM → IoPermissionError(errorCode='permission-denied')", async () => {
    mocks.readFile.mockRejectedValueOnce(errnoErr("EPERM"));
    const fs = fixedTimeout(1000);
    try {
      await fs.readFile("/private");
      throw new Error("expected EPERM mapping");
    } catch (e) {
      expect(e).toBeInstanceOf(IoPermissionError);
      expect((e as IoError).errorCode).toBe("permission-denied");
    }
  });

  it("ENOSPC → IoUnknownError(errorCode='disk-full')", async () => {
    // Per T1.7 spec, the typed exception hierarchy has exactly four subclasses
    // (IoTimeoutError, IoNotFoundError, IoPermissionError, IoUnknownError).
    // ENOSPC therefore flows through IoUnknownError, but with the closed
    // errorCode 'disk-full' so audit consumers can still distinguish it.
    mocks.writeFile.mockRejectedValueOnce(errnoErr("ENOSPC"));
    const fs = fixedTimeout(1000);
    try {
      await fs.writeFile("/p/big", "data");
      throw new Error("expected ENOSPC mapping");
    } catch (e) {
      expect(e).toBeInstanceOf(IoUnknownError);
      expect((e as IoError).errorCode).toBe("disk-full");
    }
  });

  it("unknown errno code (e.g. EFOO) → IoUnknownError(errorCode='unknown')", async () => {
    mocks.readFile.mockRejectedValueOnce(errnoErr("EFOO"));
    const fs = fixedTimeout(1000);
    try {
      await fs.readFile("/p");
      throw new Error("expected unknown mapping");
    } catch (e) {
      expect(e).toBeInstanceOf(IoUnknownError);
      expect((e as IoError).errorCode).toBe("unknown");
    }
  });

  it("error with no `code` field → IoUnknownError(errorCode='unknown')", async () => {
    mocks.readFile.mockRejectedValueOnce(new Error("naked error"));
    const fs = fixedTimeout(1000);
    try {
      await fs.readFile("/p");
      throw new Error("expected unknown mapping for code-less error");
    } catch (e) {
      expect(e).toBeInstanceOf(IoUnknownError);
      expect((e as IoError).errorCode).toBe("unknown");
    }
  });

  it("non-Error rejection (e.g. plain string) → IoUnknownError(errorCode='unknown')", async () => {
    mocks.readFile.mockRejectedValueOnce("oops");
    const fs = fixedTimeout(1000);
    try {
      await fs.readFile("/p");
      throw new Error("expected unknown mapping for non-Error rejection");
    } catch (e) {
      expect(e).toBeInstanceOf(IoUnknownError);
      expect((e as IoError).errorCode).toBe("unknown");
    }
  });

  it("preserves the original error as `cause`", async () => {
    const original = errnoErr("ENOENT");
    mocks.readFile.mockRejectedValueOnce(original);
    const fs = fixedTimeout(1000);
    try {
      await fs.readFile("/p");
      throw new Error("expected mapping");
    } catch (e) {
      expect((e as IoError).cause).toBe(original);
    }
  });
});

// ---------------------------------------------------------------------------
// No raw Error leaks
// ---------------------------------------------------------------------------

describe("NodeFs — no raw Error leaks", () => {
  it("every rejection from a public method is an instance of IoError", async () => {
    const fs = fixedTimeout(20);

    const cases: Array<() => Promise<unknown>> = [
      () => {
        mocks.readFile.mockRejectedValueOnce(errnoErr("ENOENT"));
        return fs.readFile("/p");
      },
      () => {
        mocks.writeFile.mockRejectedValueOnce(errnoErr("EACCES"));
        return fs.writeFile("/p", "x");
      },
      () => {
        mocks.lstat.mockRejectedValueOnce(errnoErr("EPERM"));
        return fs.lstat("/p");
      },
      () => {
        mocks.rename.mockRejectedValueOnce(errnoErr("ENOSPC"));
        return fs.rename("/a", "/b");
      },
      () => {
        mocks.unlink.mockRejectedValueOnce(errnoErr("EFOO"));
        return fs.unlink("/p");
      },
      () => {
        mocks.readdir.mockRejectedValueOnce(new Error("naked"));
        return fs.readdir("/p");
      },
      () => {
        mocks.realpath.mockRejectedValueOnce("not-an-error");
        return fs.realpath("/p");
      },
      () => {
        mocks.mkdir.mockImplementationOnce(() => never<void>());
        return fs.mkdir("/p");
      },
    ];

    for (const run of cases) {
      try {
        await run();
        throw new Error("expected rejection");
      } catch (e) {
        expect(e).toBeInstanceOf(IoError);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Audit alignment: every IoErrorCode is a member of ERROR_CODE_VALUES.
// This is a compile-time-flavoured runtime check that guarantees adapter codes
// can be written into an AuditEntry without violating its closed enum.
// ---------------------------------------------------------------------------

describe("NodeFs — audit-code alignment", () => {
  it("every IoErrorCode value is a member of ERROR_CODE_VALUES", () => {
    const codes: IoErrorCode[] = [
      "io-timeout",
      "source-not-found",
      "permission-denied",
      "disk-full",
      "unknown",
    ];
    for (const c of codes) {
      expect((ERROR_CODE_VALUES as readonly string[]).includes(c)).toBe(true);
    }
  });
});
