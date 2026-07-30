// MUST BE 0: a genuine EXECUTABLE call inside a template interpolation. A stripper
// that deletes ${...} along with the template text reports a FALSE ABSENCE here.
import * as fs from "fs";
export const out = `${fs.writeFileSync("x", "y")}`;
