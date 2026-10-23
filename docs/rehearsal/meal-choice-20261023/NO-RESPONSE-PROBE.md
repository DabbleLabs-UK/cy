# One minimal correction candidate after the fixed order matrix

The first 24-call matrix completed: production A chose eat 6/6 EMPTY and 6/6
FULL; reversed B chose eat 1/6 and decline 5/6 in BOTH bodily conditions. All
24 were valid. First-listed semantic action won 22/24; body marginals did not
change selection. The conditional opaque control was not admitted.

This establishes a strong joint presentation-order effect, not which of the
three aligned presentations (choices, response hint, schema enum) caused it.
Do not infer a grammar implementation bug or a particular internal mechanism.

Test exactly ONE minimal correction candidate: remove the redundant answer-looking
`response: {action: 'eat | decline'}` / reversed equivalent. Keep the menu,
schema/enum order, descriptions, body, system, model and sampler unchanged.
The existing schema already declares the response shape, so this deletion adds
no appetite rule, semantic preference, ratio target or world fact.

Use the first eight fixed matched cases from the original matrix, with new
non-overlapping probe IDs: two repetitions per body/order cell, same alternating
block order. Maximum eight additional sends, zero repair/replacement/retry.
Total real diagnostic sends are bounded to 32 (24 main + 8 correction probe).
There is no opaque-label run or other candidate correction in this execution.

The trial remains rehearsal-only. Runtime helper is unchanged during the test.
If the candidate does not remove the gross order dependence, do not retain a
runtime patch or try another correction. Report the remaining mechanism as
unisolated and recommend REVISE. If it clearly works, minimally remove that
field in the feature helper, prove byte-equivalence with tested requests and run
focused/full tests before commit. No merge/deploy regardless.

This small correction check is descriptive, not statistically conclusive or
proof of long-term agency. Do not require a desired eat/decline distribution.
