import { describe, expect, it } from "vitest";
import { greetingFor } from "./greeting";

describe("greetingFor", () => {
  it("follows the local hour bands", () => {
    expect(greetingFor(0)).toBe("Good night");
    expect(greetingFor(4)).toBe("Good night");
    expect(greetingFor(5)).toBe("Good morning");
    expect(greetingFor(11)).toBe("Good morning");
    expect(greetingFor(12)).toBe("Good afternoon");
    expect(greetingFor(16)).toBe("Good afternoon");
    expect(greetingFor(17)).toBe("Good evening");
    expect(greetingFor(20)).toBe("Good evening");
    expect(greetingFor(21)).toBe("Good night");
    expect(greetingFor(23)).toBe("Good night");
  });
});
