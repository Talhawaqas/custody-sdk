## What does this change and why?

<!-- Focus on why — the diff already shows what. -->

## Checklist

- [ ] `npx tsc --noEmit --strict --target es2020 type_check_test.ts` passes (add a usage snippet there if you added/changed a public function signature)
- [ ] Ran the relevant test script(s) for what you touched (`test_crypto_roundtrip.mjs`, `diagnostic_check.mjs`, or `test_harness.html`) and actually saw them pass — not just confirmed they exist
- [ ] Matching `.d.ts` updated if a `.js` file's exported shape changed
- [ ] `SDK_GUIDE.md` updated if this changes documented behavior (new feature, changed signature, or a bug worth a dated Known Limitations entry)
- [ ] If this touches contract ABIs/addresses: verified against the live deployed bytecode or a live `eth_call`, not just pasted source

## Related issue

Closes #
