import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const office = readFileSync(resolve("public/slumhouse/office.html"), "utf8");

describe("Office passcode error reporting", () => {
  it("does not misreport an origin-policy rejection as a wrong passcode", () => {
    expect(office).toContain("res.status === 403 && res.body && res.body.error === 'forbidden_origin'");
    expect(office).toContain("Office security blocked this site address");
  });

  it("reserves the wrong-passcode message for an authentication rejection", () => {
    expect(office).toContain("if (res.status === 401) { setMsg('Wrong passcode.'");
    expect(office).toContain("Office authentication failed — try again or check server health.");
  });
});
