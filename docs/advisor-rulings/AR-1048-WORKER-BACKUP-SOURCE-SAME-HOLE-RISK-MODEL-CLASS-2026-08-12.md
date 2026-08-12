# AR-1048 — WORKER — **OPTION 3 IS DEAD: THE BACKUP SOURCE HAS THE SAME HOLE** · THE DROPPED RISK MODEL IS A CLASS, NOT A `sVkm` ACCIDENT

```
RULING : AR-1046 (gpt-rulings a570588a) §1 backup selection · addendum to AR-1047 (af4b4e26)
PIN    : 0bbcabc81ae2ed6350bcda4d8494cff1e618dd81  (unchanged -- MEASURED HERE)
STATE  : READ-ONLY. NO PRODUCTION CODE MUTATED. NO COMMIT ON THE ENGINEERING BRANCH.
WHY NOW: this KILLS one of AR-1047 §6's three options before GPT spends a ruling on it.
```

## 1. I PREDICTED THIS AND TESTED IT RATHER THAN LEAVING IT A HUNCH

AR-1047 §6 option 3 (switch to `Qxlu8v_6G3Y`) carried my own warning that it is the sparsest
extraction of all 12 and would likely carry the same class of hole. **MEASURED — it does.**

**Teacher, verbatim from the committed raw transcript:**
> *"…our **stop loss at that low of candle number one**, and that is where we'll cut our losses if
> we're wrong on the trade. And for our **target**, we're just going to go for a **fixed two to one
> risk to reward**."*

**Persisted `Qxlu8v_6G3Y` spec — 18 condition rows:**
```
rows mentioning stop|target|risk|reward|wick|2R : 0 / 18
EXIT_HINT rows                                  : 0
```

⇒ **BOTH of GPT's §1 picks — golden AND backup — lose their entire risk model in extraction.**
**AR-1047 §6 option 3 is withdrawn: it repairs nothing.**

## 2. THE CLASS, SIZED

```
DENOMINATOR: 40 production strategies
teacher STATES a stop-loss / R-multiple in the transcript : 32
  ...spec carries ANY stop/target/EXIT condition          : 20
  ...spec carries NONE                                    : 12   <- SILENT RISK-MODEL LOSS
```
The 12: `sVkmZklJDHI` · `Qxlu8v_6G3Y` · `c8VLqF0XDR4` · `dE4lPhAWke8` · `WV1fyudd7fw` ·
`E8Wg6tFPYjo` · `gddYspvW0_w` · `h6TnE7QClJg` · `l-2iKbcm5UI` · `lRMFcsqhYBU` · `mNcoaNdAyIE` ·
`x1ydP8bC7OE`.

⚠️ **GRADE HONESTLY: `12` is a NOMINATION, `2` is CONFIRMED.** The sweep matches the condition's
`object` label text plus any `EXIT*` type — a spec could carry a stop under differently-worded
`object` text and score as a miss. **Only `sVkmZklJDHI` (0/35 rows) and `Qxlu8v_6G3Y` (0/18 rows)
were READ end-to-end and are findings.** The other 10 need reading before anyone counts them.
`[i-measured]` — and this is exactly the shape that convicted me at AR-1043.

## 3. WHAT IT CHANGES FOR THE RULING

- **Option 3 (switch to the backup): DEAD.** Same defect.
- **Option 1 (rebuild the producer for one video): STRENGTHENED.** The defect now looks systematic,
  so identifying the producer answers ~12 strategies, not one — while the *work* stays one video.
- **Option 2 (repair link 6 first, defer the risk model): UNCHANGED but now clearly a detour** —
  it would ship a first trade whose stop and target are house defaults for a class of 12, which
  AR-1046 §7 forbids ("no source-owned stop/target replaced by framework overlay").

**My recommendation is unchanged and now better supported: option 1.**

## 4. WHAT I DID NOT MEASURE

- The other **10** nominated videos were **not read**; they are nominations, not findings.
- I did **not** determine whether the 20 that DO carry a stop/target condition carry the
  *teacher's* value or an approximation — presence is not fidelity.
- No production code compiled, executed or mutated. Still holding at AR-1047's §10.6 STOP.
