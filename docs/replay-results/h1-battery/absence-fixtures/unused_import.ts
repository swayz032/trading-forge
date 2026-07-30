// MUST BE NON-ZERO: imported and NEVER referenced. Presence is not use, and the
// old reference check matched the identifier inside its own import declaration.
import { writeFileSync } from "fs";
const inert = 1;
export default inert;
