import {
  EVENT_SOURCES,
  EventSource,
  isValidEventSource,
  assertEventSource,
  ALL_COMMANDS,
  AllCommandType,
} from "../../src/common/constants";

describe("Common Constants", () => {
  describe("EVENT_SOURCES", () => {
    it("should have all required event sources", () => {
      expect(EVENT_SOURCES.SERVER).toBe("server");
      expect(EVENT_SOURCES.DRIVER).toBe("driver");
      expect(EVENT_SOURCES.DEVICE).toBe("device");
      expect(EVENT_SOURCES.STATION).toBe("station");
    });
  });

  describe("isValidEventSource", () => {
    it("should return true for valid event sources", () => {
      expect(isValidEventSource("server")).toBe(true);
      expect(isValidEventSource("driver")).toBe(true);
      expect(isValidEventSource("device")).toBe(true);
      expect(isValidEventSource("station")).toBe(true);
    });

    it("should return false for invalid event sources", () => {
      expect(isValidEventSource("invalid")).toBe(false);
      expect(isValidEventSource("")).toBe(false);
      expect(isValidEventSource("SERVER")).toBe(false); // case sensitive
      expect(isValidEventSource("DEVICE")).toBe(false);
    });

    it("should handle edge cases", () => {
      expect(isValidEventSource("123")).toBe(false);
      expect(isValidEventSource("null")).toBe(false);
      expect(isValidEventSource("undefined")).toBe(false);
    });
  });

  describe("assertEventSource", () => {
    it("should not throw for valid event sources", () => {
      expect(() => assertEventSource("server")).not.toThrow();
      expect(() => assertEventSource("driver")).not.toThrow();
      expect(() => assertEventSource("device")).not.toThrow();
      expect(() => assertEventSource("station")).not.toThrow();
    });

    it("should throw for invalid event sources", () => {
      expect(() => assertEventSource("invalid")).toThrow(
        "Invalid event source: invalid"
      );
      expect(() => assertEventSource("")).toThrow("Invalid event source: ");
      expect(() => assertEventSource("SERVER")).toThrow(
        "Invalid event source: SERVER"
      );
    });

    it("should include valid sources in error message", () => {
      try {
        assertEventSource("invalid");
      } catch (error) {
        expect((error as Error).message).toContain(
          "Valid sources are: server, driver, device, station"
        );
      }
    });
  });

  describe("ALL_COMMANDS", () => {
    it("should have all command sources", () => {
      expect(ALL_COMMANDS.DEVICE).toBeDefined();
      expect(ALL_COMMANDS.STATION).toBeDefined();
      expect(ALL_COMMANDS.DRIVER).toBeDefined();
      expect(ALL_COMMANDS.SERVER).toBeDefined();
    });

    it("should have proper structure", () => {
      expect(typeof ALL_COMMANDS.DEVICE).toBe("object");
      expect(typeof ALL_COMMANDS.STATION).toBe("object");
      expect(typeof ALL_COMMANDS.DRIVER).toBe("object");
      expect(typeof ALL_COMMANDS.SERVER).toBe("object");
    });
  });

  describe("Type System Integration", () => {
    it("should work with TypeScript type system", () => {
      const source: EventSource = "server";
      expect(isValidEventSource(source)).toBe(true);

      // This should compile without errors if types are correct
      const validSources: EventSource[] = [
        "server",
        "driver",
        "device",
        "station",
      ];
      validSources.forEach((src) => {
        expect(isValidEventSource(src)).toBe(true);
      });
    });

    it("should handle type assertions correctly", () => {
      const unknownSource: string = "device";

      // Before assertion, TypeScript treats it as string
      expect(typeof unknownSource).toBe("string");

      // After assertion, it should be treated as EventSource
      assertEventSource(unknownSource);
      // No TypeScript error should occur here
      expect(isValidEventSource(unknownSource)).toBe(true);
    });
  });

  describe("Constants Integrity", () => {
    it("should have consistent values across EVENT_SOURCES", () => {
      const sourceValues = Object.values(EVENT_SOURCES);
      const uniqueValues = new Set(sourceValues);

      // All values should be unique
      expect(sourceValues.length).toBe(uniqueValues.size);

      // All values should be strings
      sourceValues.forEach((value) => {
        expect(typeof value).toBe("string");
        expect(value.length).toBeGreaterThan(0);
      });
    });

    it("should maintain backwards compatibility", () => {
      // These are the core event sources that should never change
      const coreEventSources = ["server", "driver", "device", "station"];

      coreEventSources.forEach((source) => {
        expect(Object.values(EVENT_SOURCES)).toContain(source);
      });
    });
  });
});
